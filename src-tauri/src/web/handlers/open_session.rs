//! `acp_open_session` (fork): what a conversation view asks the server when it
//! opens — discovery and `acp_connect` in one round trip.
//!
//! Opening a conversation asked `acp_find_connection_for_conversation` (is a
//! live connection already running it — another client's, or this browser's
//! own before a reload?) and then, when not, `acp_connect`. Over a 370 ms link
//! each was a round trip the composer waited on. This answers both in one:
//! `found` is exactly discovery's answer, and `spawned` / `reused` exactly
//! what `acp_connect` hands back, so the client treats them as before. A
//! discovery that fails is skipped, as the client skipped it. Clients fall
//! back to the two calls on a server without it.
//!
//! Unlike `acp_connect`, a new connection resuming a session comes back
//! before its agent has loaded the session
//! ([`ConnectionManager::spawn_agent_returning_early`]): the client's attach
//! then overlaps the load, and the connection reads `connecting` until the
//! session has started, as a connection just made always did on the client.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::{Deserialize, Serialize};

use crate::acp::error::AcpError;
use crate::acp::idle_cap::IdleCap;
use crate::acp::manager::ConnectionManager;
use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::acp as acp_commands;
use crate::db::AppDatabase;
use crate::models::agent::AgentType;
use crate::web::event_bridge::EventEmitter;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionParams {
    pub agent_type: AgentType,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    /// A persisted conversation (id > 0) is looked for first; a draft has none.
    #[serde(default)]
    pub conversation_id: Option<i32>,
    #[serde(default)]
    pub preferred_mode_id: Option<String>,
    #[serde(default)]
    pub preferred_config_values: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenOutcome {
    /// A live connection already runs this conversation.
    Found,
    /// `acp_connect` started a new agent.
    Spawned,
    /// `acp_connect`'s dedup handed back a live connection for the session.
    Reused,
}

#[derive(Debug, Serialize)]
pub struct OpenSessionResult {
    pub connection_id: String,
    pub outcome: OpenOutcome,
    /// The found connection's progress (informational, as discovery's);
    /// `None` for a connection `acp_connect` handed back.
    pub event_seq: Option<u64>,
    /// Idle agents the server keeps warm; `0` when there is no cap.
    pub idle_cap: usize,
}

pub(crate) async fn acp_open_session_core(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    emitter: EventEmitter,
    owner_window_label: &str,
    params: OpenSessionParams,
) -> Result<OpenSessionResult, AcpError> {
    let idle_cap = IdleCap::configured().map_or(0, |cap| cap.max_idle);
    if let Some(conversation_id) = params.conversation_id.filter(|id| *id > 0) {
        match acp_commands::acp_find_connection_for_conversation_core(
            manager,
            &db.conn,
            conversation_id,
            params.session_id.as_deref(),
            params.agent_type,
        )
        .await
        {
            Ok(Some(found)) => {
                return Ok(OpenSessionResult {
                    connection_id: found.connection_id,
                    outcome: OpenOutcome::Found,
                    event_seq: Some(found.event_seq),
                    idle_cap,
                })
            }
            Ok(None) => {}
            Err(error) => tracing::warn!(
                "[ACP] open_session: discovery failed for conversation {}: {}",
                conversation_id,
                error
            ),
        }
    }

    // From here exactly `acp_connect`.
    let runtime_env = acp_commands::build_session_runtime_env(
        db,
        params.agent_type,
        params.session_id.as_deref(),
        data_dir,
    )
    .await?;
    acp_commands::verify_agent_installed(params.agent_type).await?;
    // A resumed session comes back while its agent is still loading it, so
    // the client's attach overlaps the load.
    let outcome = manager
        .spawn_agent_returning_early(
            params.agent_type,
            params.working_dir,
            params.session_id,
            runtime_env,
            owner_window_label.to_string(),
            emitter,
            params.preferred_mode_id,
            params.preferred_config_values.unwrap_or_default(),
        )
        .await?;
    manager.mark_ui_session(&outcome.connection_id);
    Ok(OpenSessionResult {
        connection_id: outcome.connection_id,
        outcome: if outcome.reused {
            OpenOutcome::Reused
        } else {
            OpenOutcome::Spawned
        },
        event_seq: None,
        idle_cap,
    })
}

pub async fn acp_open_session(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<OpenSessionParams>,
) -> Result<Json<OpenSessionResult>, AppCommandError> {
    acp_open_session_core(
        &state.connection_manager,
        &state.db,
        &state.data_dir,
        state.emitter.clone(),
        "web",
        params,
    )
    .await
    .map(Json)
    // As `acp_connect`, so the client reads a failed spawn the same way.
    .map_err(|e| AppCommandError::task_execution_failed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(conversation_id: Option<i32>, session_id: Option<&str>) -> OpenSessionParams {
        OpenSessionParams {
            agent_type: AgentType::ClaudeCode,
            working_dir: None,
            session_id: session_id.map(str::to_string),
            conversation_id,
            preferred_mode_id: None,
            preferred_config_values: None,
        }
    }

    async fn live(mgr: &ConnectionManager, id: &str, conversation: Option<i32>, external: &str) {
        mgr.insert_test_connection(id, AgentType::ClaudeCode, None, EventEmitter::Noop)
            .await;
        let state = mgr.get_state(id).await.expect("state");
        let mut s = state.write().await;
        s.conversation_id = conversation;
        s.external_id = Some(external.to_string());
        s.event_seq = 9;
    }

    #[tokio::test]
    async fn finds_the_live_connection_without_spawning() {
        let mgr = ConnectionManager::new();
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let data = tempfile::tempdir().unwrap();
        live(&mgr, "running", Some(42), "sess-a").await;

        let opened = acp_open_session_core(
            &mgr,
            &db,
            data.path(),
            EventEmitter::Noop,
            "web",
            params(Some(42), Some("sess-a")),
        )
        .await
        .expect("found");
        assert_eq!(opened.connection_id, "running");
        assert_eq!(opened.outcome, OpenOutcome::Found);
        assert_eq!(opened.event_seq, Some(9));
        assert_eq!(
            opened.idle_cap,
            IdleCap::configured().map_or(0, |c| c.max_idle)
        );
        assert_eq!(mgr.connections.lock().await.len(), 1, "nothing spawned");
    }

    #[tokio::test]
    async fn finds_by_session_before_the_first_prompt_binds_it() {
        let mgr = ConnectionManager::new();
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let data = tempfile::tempdir().unwrap();
        live(&mgr, "unbound", None, "sess-b").await;

        let opened = acp_open_session_core(
            &mgr,
            &db,
            data.path(),
            EventEmitter::Noop,
            "web",
            params(Some(7), Some("sess-b")),
        )
        .await
        .expect("found");
        assert_eq!(
            (opened.connection_id.as_str(), opened.outcome),
            ("unbound", OpenOutcome::Found)
        );
    }

    #[test]
    fn answers_in_the_shape_the_client_reads() {
        let json = serde_json::to_value(OpenSessionResult {
            connection_id: "c".into(),
            outcome: OpenOutcome::Reused,
            event_seq: None,
            idle_cap: 6,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "connection_id": "c",
                "outcome": "reused",
                "event_seq": null,
                "idle_cap": 6,
            })
        );
    }
}
