//! keh4l build: what a finished delegation looks like once it has been handed
//! back to the parent agent — the [`ContentBlock::DelegationResults`] block a
//! transcript shows in place of the internal results frame (see
//! `crate::acp::delegation::notice`), and the live
//! `AcpEvent::DelegationResultsDelivered` event.
//!
//! [`ContentBlock::DelegationResults`]: crate::models::message::ContentBlock::DelegationResults

use serde::{Deserialize, Serialize};

/// How a batch of results reached the parent agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DelegationResultsMode {
    /// A turn of its own, started because the parent was idle.
    Wake,
    /// Injected into the turn the parent was running.
    Steer,
    /// Appended to the next prompt the parent was sent.
    Attached,
}

/// The worktree a delegated task ran in (`isolation: "worktree"`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DelegationWorktreeInfo {
    pub path: String,
    pub branch: String,
    pub base_sha: String,
    /// One line on what changed there, e.g. "3 files changed, 1 uncommitted".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changes: Option<String>,
}

/// One task in a delivered batch, as the UI shows it: the result is a bounded
/// preview, the full text stays in the child conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DelegationResultsTask {
    pub task_id: String,
    pub agent_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assistant: Option<String>,
    /// `completed` / `failed` / `canceled`.
    pub status: String,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    pub child_conversation_id: i32,
    #[serde(default)]
    pub resumable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<DelegationWorktreeInfo>,
}
