//! keh4l build: HTTP mirror of `commands::follow_up`.

use axum::Json;
use serde::Deserialize;

use crate::acp::follow_up::{self, NextMessage, QueueView, SteerRecord, SteerResult};
use crate::acp::types::PromptInputBlock;
use crate::app_error::AppCommandError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteerParams {
    pub connection_id: String,
    #[serde(default)]
    pub conversation_id: Option<i32>,
    pub text: String,
    pub blocks: Vec<PromptInputBlock>,
    /// keh4l build: queue it as the next message if the turn has ended.
    #[serde(default)]
    pub next_message: Option<NextMessage>,
}

pub async fn follow_up_steer(
    Json(p): Json<SteerParams>,
) -> Result<Json<SteerResult>, AppCommandError> {
    Ok(Json(match p.next_message {
        Some(next) => {
            follow_up::steer_or_queue(&p.connection_id, p.conversation_id, p.text, p.blocks, next)
                .await?
        }
        None => follow_up::steer(&p.connection_id, p.conversation_id, p.text, p.blocks).await?,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueParams {
    pub conversation_id: i32,
    #[serde(default)]
    pub connection_id: Option<String>,
    pub text: String,
    pub blocks: Vec<PromptInputBlock>,
    #[serde(default)]
    pub mode_id: Option<String>,
    #[serde(default)]
    pub adopt_send_time_mode: Option<bool>,
    /// keh4l build: the item id the client chose (a UUID).
    #[serde(default)]
    pub client_id: Option<String>,
}

pub async fn follow_up_enqueue(
    Json(p): Json<EnqueueParams>,
) -> Result<Json<String>, AppCommandError> {
    Ok(Json(
        follow_up::enqueue_as(
            p.conversation_id,
            p.connection_id.as_deref(),
            p.text,
            p.blocks,
            p.mode_id,
            p.adopt_send_time_mode.unwrap_or(false),
            p.client_id,
        )
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationParams {
    pub conversation_id: i32,
}

pub async fn follow_up_list(
    Json(p): Json<ConversationParams>,
) -> Result<Json<QueueView>, AppCommandError> {
    Ok(Json(follow_up::list(p.conversation_id).await?))
}

pub async fn follow_up_steers(
    Json(p): Json<ConversationParams>,
) -> Result<Json<Vec<SteerRecord>>, AppCommandError> {
    Ok(Json(follow_up::steers(p.conversation_id).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateParams {
    pub item_id: String,
    pub text: String,
    pub blocks: Vec<PromptInputBlock>,
}

pub async fn follow_up_update(Json(p): Json<UpdateParams>) -> Result<Json<()>, AppCommandError> {
    follow_up::update(&p.item_id, p.text, p.blocks).await?;
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemParams {
    pub item_id: String,
}

pub async fn follow_up_remove(Json(p): Json<ItemParams>) -> Result<Json<()>, AppCommandError> {
    follow_up::remove(&p.item_id).await?;
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderParams {
    pub conversation_id: i32,
    pub ids: Vec<String>,
}

pub async fn follow_up_reorder(Json(p): Json<ReorderParams>) -> Result<Json<()>, AppCommandError> {
    follow_up::reorder(p.conversation_id, p.ids).await?;
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeParams {
    pub conversation_id: i32,
    #[serde(default)]
    pub connection_id: Option<String>,
}

pub async fn follow_up_resume(Json(p): Json<ResumeParams>) -> Result<Json<()>, AppCommandError> {
    follow_up::resume(p.conversation_id, p.connection_id.as_deref()).await?;
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KickParams {
    pub conversation_id: i32,
    pub connection_id: String,
}

pub async fn follow_up_kick(Json(p): Json<KickParams>) -> Result<Json<bool>, AppCommandError> {
    Ok(Json(
        follow_up::kick(p.conversation_id, &p.connection_id).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendNowParams {
    pub item_id: String,
    pub connection_id: String,
}

pub async fn follow_up_send_now(
    Json(p): Json<SendNowParams>,
) -> Result<Json<SteerResult>, AppCommandError> {
    Ok(Json(
        follow_up::send_now(&p.item_id, &p.connection_id).await?,
    ))
}
