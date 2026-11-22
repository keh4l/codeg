//! keh4l build: HTTP mirror of `commands::transcript_view`.

use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::transcript_view::{
    get_conversation_minimap_core, search_conversation_core, ConversationMinimapEntry,
    ConversationSearchResult,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConversationParams {
    pub conversation_id: i32,
    pub query: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub limit: Option<u32>,
}

pub async fn search_conversation(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SearchConversationParams>,
) -> Result<Json<ConversationSearchResult>, AppCommandError> {
    Ok(Json(
        search_conversation_core(
            &state.db.conn,
            params.conversation_id,
            params.query,
            params.case_sensitive,
            params.limit,
        )
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetConversationMinimapParams {
    pub conversation_id: i32,
}

pub async fn get_conversation_minimap(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetConversationMinimapParams>,
) -> Result<Json<Vec<ConversationMinimapEntry>>, AppCommandError> {
    Ok(Json(
        get_conversation_minimap_core(&state.db.conn, params.conversation_id).await?,
    ))
}
