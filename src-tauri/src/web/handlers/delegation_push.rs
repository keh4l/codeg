//! keh4l build: HTTP mirror of `commands::delegation_push`.

use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::acp::delegation::delivery::{self, DelegationPushSettings};
use crate::app_error::AppCommandError;
use crate::app_state::AppState;

pub async fn get_delegation_push_settings() -> Result<Json<DelegationPushSettings>, AppCommandError>
{
    Ok(Json(delivery::get_settings()))
}

#[derive(Deserialize)]
pub struct SetDelegationPushSettingsParams {
    pub settings: DelegationPushSettings,
}

pub async fn set_delegation_push_settings(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetDelegationPushSettingsParams>,
) -> Result<Json<DelegationPushSettings>, AppCommandError> {
    let saved =
        delivery::set_settings_core(&state.db.conn, &state.emitter, params.settings).await?;
    Ok(Json(saved))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopDelegationTasksParams {
    pub task_ids: Vec<String>,
}

/// The user stops delegated tasks (the live-runs list's stop buttons).
pub async fn stop_delegation_tasks(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<StopDelegationTasksParams>,
) -> Result<Json<usize>, AppCommandError> {
    Ok(Json(
        state
            .delegation_broker
            .user_stop_tasks(&params.task_ids)
            .await,
    ))
}
