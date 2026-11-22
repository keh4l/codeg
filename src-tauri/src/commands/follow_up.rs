//! keh4l build: steer or queue while the agent replies (`crate::acp::follow_up`),
//! as Tauri commands. The web handlers in `web::handlers::follow_up` call the
//! same functions; the engine is process-global, so neither needs app state.

use crate::acp::follow_up::{self, QueueView, SteerRecord, SteerResult};
use crate::acp::types::PromptInputBlock;
use crate::app_error::AppCommandError;

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_steer(
    connection_id: String,
    conversation_id: Option<i32>,
    text: String,
    blocks: Vec<PromptInputBlock>,
) -> Result<SteerResult, AppCommandError> {
    follow_up::steer(&connection_id, conversation_id, text, blocks).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_enqueue(
    conversation_id: i32,
    connection_id: Option<String>,
    text: String,
    blocks: Vec<PromptInputBlock>,
    mode_id: Option<String>,
    adopt_send_time_mode: Option<bool>,
) -> Result<String, AppCommandError> {
    follow_up::enqueue(
        conversation_id,
        connection_id.as_deref(),
        text,
        blocks,
        mode_id,
        adopt_send_time_mode.unwrap_or(false),
    )
    .await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_list(conversation_id: i32) -> Result<QueueView, AppCommandError> {
    follow_up::list(conversation_id).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_update(
    item_id: String,
    text: String,
    blocks: Vec<PromptInputBlock>,
) -> Result<(), AppCommandError> {
    follow_up::update(&item_id, text, blocks).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_remove(item_id: String) -> Result<(), AppCommandError> {
    follow_up::remove(&item_id).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_reorder(
    conversation_id: i32,
    ids: Vec<String>,
) -> Result<(), AppCommandError> {
    follow_up::reorder(conversation_id, ids).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_resume(
    conversation_id: i32,
    connection_id: Option<String>,
) -> Result<(), AppCommandError> {
    follow_up::resume(conversation_id, connection_id.as_deref()).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_kick(
    conversation_id: i32,
    connection_id: String,
) -> Result<bool, AppCommandError> {
    follow_up::kick(conversation_id, &connection_id).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_send_now(
    item_id: String,
    connection_id: String,
) -> Result<SteerResult, AppCommandError> {
    follow_up::send_now(&item_id, &connection_id).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn follow_up_steers(conversation_id: i32) -> Result<Vec<SteerRecord>, AppCommandError> {
    follow_up::steers(conversation_id).await
}
