//! `acp_get_session_flags` (fork): the handful of fields of a live session the
//! conversation UI reads when it opens.
//!
//! The goal controls and the feedback bar each fetched the whole
//! `acp_get_session_snapshot` — the live turn with every tool call's output,
//! often hundreds of KB — to read a vocabulary list and two booleans, two or
//! three times per conversation opened. Over a slow link that was most of what
//! an open waited for. This returns only those fields, with the same meaning
//! as on the snapshot (`goal_actions: null` = not answered yet). Clients fall
//! back to the snapshot on a server without it.

use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::{Deserialize, Serialize};

use crate::acp::feedback::FeedbackItem;
use crate::app_error::AppCommandError;
use crate::app_state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFlagsParams {
    pub connection_id: String,
}

/// Mirrors the same-named fields of `LiveSessionSnapshot`.
#[derive(Debug, Serialize)]
pub struct SessionFlags {
    pub goal_actions: Option<Vec<String>>,
    pub feedback_tool_available: bool,
    pub native_steering_available: bool,
    /// Omitted while empty, as on the snapshot.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub feedback: Vec<FeedbackItem>,
}

/// `None` when the connection is gone, as the snapshot.
pub async fn acp_get_session_flags(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SessionFlagsParams>,
) -> Result<Json<Option<SessionFlags>>, AppCommandError> {
    let Some(session) = state
        .connection_manager
        .get_state(&params.connection_id)
        .await
    else {
        return Ok(Json(None));
    };
    let s = session.read().await;
    Ok(Json(Some(SessionFlags {
        goal_actions: s.goal_actions.clone(),
        feedback_tool_available: s.feedback_tool_available,
        native_steering_available: s.native_steering_available,
        feedback: s.feedback.clone(),
    })))
}
