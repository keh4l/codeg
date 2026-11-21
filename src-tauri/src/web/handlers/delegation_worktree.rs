//! keh4l build: HTTP mirror of `commands::delegation_worktree`.

use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::delegation_worktree::{
    delegation_worktree_for_conversation_core, get_delegation_worktree_core,
    remove_delegation_worktree_core, DelegationWorktreeState,
};
use crate::commands::folders::GitWorktreeRemoval;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskParams {
    pub task_id: String,
}

pub async fn get_delegation_worktree(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<TaskParams>,
) -> Result<Json<Option<DelegationWorktreeState>>, AppCommandError> {
    Ok(Json(
        get_delegation_worktree_core(&state.db, &params.task_id).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationParams {
    pub conversation_id: i32,
}

pub async fn delegation_worktree_for_conversation(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ConversationParams>,
) -> Result<Json<Option<DelegationWorktreeState>>, AppCommandError> {
    Ok(Json(
        delegation_worktree_for_conversation_core(&state.db, params.conversation_id).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveParams {
    pub task_id: String,
    pub delete_branch: bool,
    #[serde(default)]
    pub force: Option<bool>,
}

pub async fn remove_delegation_worktree(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<RemoveParams>,
) -> Result<Json<GitWorktreeRemoval>, AppCommandError> {
    Ok(Json(
        remove_delegation_worktree_core(
            &state.emitter,
            &state.db,
            &params.task_id,
            params.delete_branch,
            params.force.unwrap_or(false),
        )
        .await?,
    ))
}
