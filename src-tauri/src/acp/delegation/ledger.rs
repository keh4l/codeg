//! keh4l build: the broker's durable record of delegated tasks (the
//! `delegation_task` table), behind a trait so broker tests run without a
//! database. It keeps what the broker's memory loses on a restart: what a task
//! was launched with (a resumed or continued round reuses it), the worktree it
//! made, and how it ended.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::db::entities::delegation_task;
use crate::db::service::{delegation_task_service, folder_service};
use crate::db::AppDatabase;
use crate::web::event_bridge::EventEmitter;

/// The options a child was launched with, after every layer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaunchRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub config: BTreeMap<String, String>,
}

/// A task's row as the broker uses it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerRow {
    pub task_id: String,
    pub parent_conversation_id: i32,
    pub child_conversation_id: Option<i32>,
    pub parent_tool_use_id: Option<String>,
    pub round: i32,
    pub source_task_id: Option<String>,
    pub agent_type: String,
    pub assistant_id: Option<i32>,
    pub assistant_name: Option<String>,
    pub launch: LaunchRecord,
    pub requested_model: Option<String>,
    pub isolation: String,
    pub working_dir: Option<String>,
    pub worktree_repo: Option<String>,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub worktree_base_sha: Option<String>,
    pub task_text: Option<String>,
    pub request_hash: Option<String>,
    pub status: String,
    pub error_code: Option<String>,
    pub duration_ms: Option<u64>,
    pub result_preview: Option<String>,
}

impl LedgerRow {
    pub fn new(task_id: &str, parent_conversation_id: i32, agent_type: &str) -> Self {
        Self {
            task_id: task_id.to_string(),
            parent_conversation_id,
            child_conversation_id: None,
            parent_tool_use_id: None,
            round: 1,
            source_task_id: None,
            agent_type: agent_type.to_string(),
            assistant_id: None,
            assistant_name: None,
            launch: LaunchRecord::default(),
            requested_model: None,
            isolation: "shared".to_string(),
            working_dir: None,
            worktree_repo: None,
            worktree_path: None,
            worktree_branch: None,
            worktree_base_sha: None,
            task_text: None,
            request_hash: None,
            status: "running".to_string(),
            error_code: None,
            duration_ms: None,
            result_preview: None,
        }
    }
}

impl From<delegation_task::Model> for LedgerRow {
    fn from(m: delegation_task::Model) -> Self {
        Self {
            launch: m
                .launch_config
                .as_deref()
                .and_then(|raw| serde_json::from_str(raw).ok())
                .unwrap_or_default(),
            task_id: m.task_id,
            parent_conversation_id: m.parent_conversation_id,
            child_conversation_id: m.child_conversation_id,
            parent_tool_use_id: m.parent_tool_use_id,
            round: m.round,
            source_task_id: m.source_task_id,
            agent_type: m.agent_type,
            assistant_id: m.assistant_id,
            assistant_name: m.assistant_name,
            requested_model: m.requested_model,
            isolation: m.isolation,
            working_dir: m.working_dir,
            worktree_repo: m.worktree_repo,
            worktree_path: m.worktree_path,
            worktree_branch: m.worktree_branch,
            worktree_base_sha: m.worktree_base_sha,
            task_text: m.task_text,
            request_hash: m.request_hash,
            status: m.status,
            error_code: m.error_code,
            duration_ms: m.duration_ms.map(|d| d.max(0) as u64),
            result_preview: m.result_preview,
        }
    }
}

/// Characters of result text the ledger keeps.
pub const RESULT_PREVIEW_CAP: usize = 2048;

#[async_trait]
pub trait DelegationLedger: Send + Sync {
    /// Record a task that started. `false` when a row for its id, or a round
    /// continuing the same source, is already there.
    async fn insert(&self, row: LedgerRow) -> bool;
    async fn set_child_conversation(&self, task_id: &str, child_conversation_id: i32);
    async fn finish(
        &self,
        task_id: &str,
        status: &str,
        error_code: Option<String>,
        duration_ms: u64,
        result_preview: Option<String>,
    );
    async fn mark_running(&self, task_id: &str);
    async fn get(&self, task_id: &str) -> Option<LedgerRow>;
    async fn successor_of(&self, task_id: &str) -> Option<LedgerRow>;
    /// The work-task worktree location of the parent conversation's folder.
    async fn worktree_location(&self, parent_conversation_id: i32) -> Option<String>;
    /// Give a worktree made for the parent conversation's task a folder row
    /// under the parent's root folder (opened beside it when that is open).
    async fn register_worktree_folder(&self, parent_conversation_id: i32, path: &str);
}

pub struct DbLedger {
    pub db: Arc<AppDatabase>,
    pub emitter: EventEmitter,
}

fn active(row: LedgerRow) -> delegation_task::ActiveModel {
    use sea_orm::Set;
    delegation_task::ActiveModel {
        task_id: Set(row.task_id),
        parent_conversation_id: Set(row.parent_conversation_id),
        child_conversation_id: Set(row.child_conversation_id),
        parent_tool_use_id: Set(row.parent_tool_use_id),
        round: Set(row.round),
        source_task_id: Set(row.source_task_id),
        agent_type: Set(row.agent_type),
        assistant_id: Set(row.assistant_id),
        assistant_name: Set(row.assistant_name),
        launch_config: Set(serde_json::to_string(&row.launch).ok()),
        requested_model: Set(row.requested_model),
        isolation: Set(row.isolation),
        working_dir: Set(row.working_dir),
        worktree_repo: Set(row.worktree_repo),
        worktree_path: Set(row.worktree_path),
        worktree_branch: Set(row.worktree_branch),
        worktree_base_sha: Set(row.worktree_base_sha),
        worktree_removed_at: Set(None),
        task_text: Set(row.task_text),
        request_hash: Set(row.request_hash),
        status: Set(row.status),
        error_code: Set(row.error_code),
        duration_ms: Set(row.duration_ms.map(|d| d.min(i64::MAX as u64) as i64)),
        result_preview: Set(row.result_preview),
        created_at: Set(chrono::Utc::now()),
        finished_at: Set(None),
    }
}

#[async_trait]
impl DelegationLedger for DbLedger {
    async fn insert(&self, row: LedgerRow) -> bool {
        let task_id = row.task_id.clone();
        match delegation_task_service::insert(&self.db.conn, active(row)).await {
            Ok(()) => true,
            Err(e) => {
                tracing::info!("[delegation][ledger] not recording task {task_id}: {e}");
                false
            }
        }
    }

    async fn set_child_conversation(&self, task_id: &str, child_conversation_id: i32) {
        if let Err(e) = delegation_task_service::set_child_conversation(
            &self.db.conn,
            task_id,
            child_conversation_id,
        )
        .await
        {
            tracing::warn!("[delegation][ledger] task {task_id}: {e}");
        }
    }

    async fn finish(
        &self,
        task_id: &str,
        status: &str,
        error_code: Option<String>,
        duration_ms: u64,
        result_preview: Option<String>,
    ) {
        if let Err(e) = delegation_task_service::finish(
            &self.db.conn,
            task_id,
            status,
            error_code,
            duration_ms,
            result_preview,
        )
        .await
        {
            tracing::warn!("[delegation][ledger] finishing task {task_id}: {e}");
        }
    }

    async fn mark_running(&self, task_id: &str) {
        let _ = delegation_task_service::mark_running(&self.db.conn, task_id).await;
    }

    async fn get(&self, task_id: &str) -> Option<LedgerRow> {
        delegation_task_service::get(&self.db.conn, task_id)
            .await
            .ok()
            .flatten()
            .map(Into::into)
    }

    async fn successor_of(&self, task_id: &str) -> Option<LedgerRow> {
        delegation_task_service::successor_of(&self.db.conn, task_id)
            .await
            .ok()
            .flatten()
            .map(Into::into)
    }

    async fn worktree_location(&self, parent_conversation_id: i32) -> Option<String> {
        let row = crate::db::service::conversation_service::get_by_id(
            &self.db.conn,
            parent_conversation_id,
        )
        .await
        .ok()?;
        let folder = folder_service::get_folder_by_id(&self.db.conn, row.folder_id)
            .await
            .ok()
            .flatten()?;
        let root_id = folder.parent_id.unwrap_or(folder.id);
        crate::db::service::work_task_service::settings_get_effective(&self.db.conn, root_id)
            .await
            .ok()?
            .worktree_root
            .filter(|r| !r.trim().is_empty())
    }

    async fn register_worktree_folder(&self, parent_conversation_id: i32, path: &str) {
        let result: Result<(), String> = async {
            let row = crate::db::service::conversation_service::get_by_id(
                &self.db.conn,
                parent_conversation_id,
            )
            .await
            .map_err(|e| e.to_string())?;
            let source = folder_service::get_folder_by_id(&self.db.conn, row.folder_id)
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "the parent's folder is gone".to_string())?;
            let root_id = source.parent_id.unwrap_or(source.id);
            if folder_service::is_open(&self.db.conn, root_id)
                .await
                .unwrap_or(false)
            {
                let detail = crate::commands::folders::open_worktree_folder_core(
                    &self.db,
                    path.to_string(),
                    source.id,
                )
                .await
                .map_err(|e| e.to_string())?;
                crate::commands::folders::emit_folder_upsert(&self.emitter, detail);
                return Ok(());
            }
            let entry = folder_service::ensure_worktree_folder_closed(&self.db.conn, path, root_id)
                .await
                .map_err(|e| e.to_string())?;
            crate::commands::folders::seed_worktree_alias(&self.db, entry.id, path).await;
            Ok(())
        }
        .await;
        if let Err(e) = result {
            tracing::warn!("[delegation][worktree] no folder row for {path}: {e}");
        }
    }
}

/// The task id a delegation tool's result names (`task_id=<uuid>`).
fn task_id_in(output: &str) -> Option<String> {
    let at = output.find("task_id=")? + "task_id=".len();
    let id: String = output[at..]
        .chars()
        .take_while(|c| c.is_ascii_hexdigit() || *c == '-')
        .collect();
    (id.len() >= 32).then_some(id)
}

/// A ledger row as the `codeg.delegation` meta a card reads after a reload.
fn row_meta(row: &LedgerRow) -> serde_json::Map<String, serde_json::Value> {
    use serde_json::json;
    let mut meta = serde_json::Map::new();
    meta.insert(
        "status".into(),
        json!(match row.status.as_str() {
            "running" => "running",
            "completed" => "completed",
            _ => "failed",
        }),
    );
    meta.insert("task_id".into(), json!(row.task_id));
    if let Some(child) = row.child_conversation_id {
        meta.insert("child_conversation_id".into(), json!(child));
    }
    if row.status != "completed" && row.status != "running" {
        meta.insert(
            "error_code".into(),
            json!(row
                .error_code
                .clone()
                .unwrap_or_else(|| "canceled".to_string())),
        );
    }
    if let Some(ms) = row.duration_ms {
        meta.insert("duration_ms".into(), json!(ms));
    }
    meta.insert("agent_type".into(), json!(row.agent_type));
    fork_fields(row, &mut meta);
    meta
}

/// The keh4l-only fields: model, isolation, worktree, round.
fn fork_fields(row: &LedgerRow, meta: &mut serde_json::Map<String, serde_json::Value>) {
    use serde_json::json;
    if let Some(model) = &row.requested_model {
        meta.insert("model".into(), json!(model));
    }
    if row.isolation != "shared" {
        meta.insert("isolation".into(), json!(row.isolation));
    }
    if let (Some(path), Some(branch)) = (&row.worktree_path, &row.worktree_branch) {
        meta.insert(
            "worktree".into(),
            json!({
                "path": path,
                "branch": branch,
                "base_sha": row.worktree_base_sha.clone().unwrap_or_default(),
            }),
        );
    }
    if row.round > 1 {
        meta.insert("round".into(), json!(row.round));
    }
}

/// After a reload: give `continue_delegation` calls the meta their cards need
/// (status, child, round — the conversation rows know only the first round),
/// and add the launch facts to `delegate_to_agent` calls the ledger knows.
pub async fn inject_ledger_meta(
    conn: &sea_orm::DatabaseConnection,
    turns: &mut [crate::models::message::MessageTurn],
) {
    use crate::models::message::ContentBlock;
    let mut task_by_call: std::collections::HashMap<String, String> = Default::default();
    for turn in turns.iter() {
        for block in &turn.blocks {
            if let ContentBlock::ToolResult {
                tool_use_id: Some(tu),
                output_preview: Some(output),
                ..
            } = block
            {
                if let Some(id) = task_id_in(output) {
                    task_by_call.insert(tu.clone(), id);
                }
            }
        }
    }
    if task_by_call.is_empty() {
        return;
    }
    for turn in turns.iter_mut() {
        for block in turn.blocks.iter_mut() {
            let ContentBlock::ToolUse {
                tool_use_id: Some(tu),
                tool_name,
                meta,
                ..
            } = block
            else {
                continue;
            };
            let continuation = tool_name.contains("continue_delegation");
            if !continuation && !tool_name.contains("delegate_to_agent") {
                continue;
            }
            let Some(task_id) = task_by_call.get(tu.as_str()) else {
                continue;
            };
            let Ok(Some(row)) = delegation_task_service::get(conn, task_id).await else {
                continue;
            };
            let row = LedgerRow::from(row);
            if continuation && meta.is_none() {
                *meta = Some(serde_json::json!({ "codeg.delegation": row_meta(&row) }));
                continue;
            }
            if let Some(inner) = meta
                .as_mut()
                .and_then(|m| m.get_mut("codeg.delegation"))
                .and_then(serde_json::Value::as_object_mut)
            {
                fork_fields(&row, inner);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_task_id_is_read_off_a_result() {
        assert_eq!(
            task_id_in(
                "Continuation started. task_id=9f3a1c22-0000-4000-8000-000000000000 — round 2"
            )
            .as_deref(),
            Some("9f3a1c22-0000-4000-8000-000000000000")
        );
        assert_eq!(task_id_in("no id here"), None);
    }

    #[test]
    fn a_continued_round_reads_as_its_card_needs() {
        let mut row = LedgerRow::new("b", 7, "codex");
        row.round = 2;
        row.child_conversation_id = Some(42);
        row.status = "completed".into();
        row.worktree_path = Some("/w/x".into());
        row.worktree_branch = Some("delegate/x".into());
        row.isolation = "worktree".into();
        let meta = row_meta(&row);
        assert_eq!(meta["status"], "completed");
        assert_eq!(meta["round"], 2);
        assert_eq!(meta["child_conversation_id"], 42);
        assert_eq!(meta["worktree"]["branch"], "delegate/x");
        assert!(meta.get("error_code").is_none());
    }
}
