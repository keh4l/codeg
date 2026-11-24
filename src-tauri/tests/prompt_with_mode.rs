//! `acp_prompt` with `modeId` (fork): the mode change is queued on the
//! connection ahead of the prompt, in one request.

use std::sync::Arc;

use axum_test::TestServer;
use codeg_lib::acp::connection::ConnectionCommand;
use codeg_lib::app_state::AppState;
use codeg_lib::db::test_helpers::fresh_in_memory_db;
use codeg_lib::models::AgentType;
use codeg_lib::web::event_bridge::EventEmitter;
use codeg_lib::web::router::build_router;
use codeg_lib::web::shutdown::ShutdownSignal;
use serde_json::json;

const TOKEN: &str = "prompt-with-mode-token";

#[tokio::test]
async fn the_mode_goes_ahead_of_the_prompt() {
    let data_dir = tempfile::tempdir().expect("data dir");
    let static_dir = tempfile::tempdir().expect("static dir");
    let db = fresh_in_memory_db().await;
    let state = Arc::new(AppState::new_for_test(db, data_dir.path().to_path_buf()));
    let mut rx = state
        .connection_manager
        .insert_test_connection_live("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
        .await;
    let router = build_router(
        state,
        TOKEN.to_string(),
        static_dir.path().to_path_buf(),
        Arc::new(ShutdownSignal::new()),
    );
    let server = TestServer::builder()
        .http_transport()
        .build(router)
        .expect("test server");

    let call = |cmd: &str, body: serde_json::Value| {
        server
            .post(&format!("/api/{cmd}"))
            .add_header("authorization", format!("Bearer {TOKEN}"))
            .json(&body)
    };
    let folder: serde_json::Value = call(
        "open_folder",
        json!({ "path": "/tmp/codeg-prompt-with-mode" }),
    )
    .await
    .json();
    let conversation: i64 = call(
        "create_conversation",
        json!({ "folderId": folder["id"], "agentType": "claude_code" }),
    )
    .await
    .json();

    let resp = call(
        "acp_prompt",
        json!({
            "connectionId": "c1",
            "blocks": [{ "type": "text", "text": "hello" }],
            "folderId": folder["id"],
            "conversationId": conversation,
            "modeId": "plan",
        }),
    )
    .await;
    assert_eq!(resp.status_code(), 200, "{}", resp.text());

    match rx.try_recv() {
        Ok(ConnectionCommand::SetMode { mode_id, .. }) => assert_eq!(mode_id, "plan"),
        _ => panic!("the mode change comes first"),
    }
    assert!(
        matches!(rx.try_recv(), Ok(ConnectionCommand::Prompt { .. })),
        "then the prompt"
    );
}
