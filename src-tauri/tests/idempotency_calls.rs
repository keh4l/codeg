//! `X-Codeg-Idempotency-Key` (fork): a call sent again with the same key
//! gets the first call's answer instead of running twice — after it, or while
//! it is still running — and the key is scoped to its path.

use std::sync::Arc;

use axum_test::TestServer;
use codeg_lib::app_state::AppState;
use codeg_lib::db::test_helpers::fresh_in_memory_db;
use codeg_lib::web::router::build_router;
use codeg_lib::web::shutdown::ShutdownSignal;
use serde_json::{json, Value};

const TOKEN: &str = "idempotency-calls-token";

async fn build_server() -> (TestServer, tempfile::TempDir, tempfile::TempDir) {
    let data_dir = tempfile::tempdir().expect("data dir");
    let static_dir = tempfile::tempdir().expect("static dir");
    let db = fresh_in_memory_db().await;
    let state = Arc::new(AppState::new_for_test(db, data_dir.path().to_path_buf()));
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
    (server, data_dir, static_dir)
}

async fn call(server: &TestServer, cmd: &str, args: Value, key: Option<&str>) -> (u16, Value) {
    let mut req = server
        .post(&format!("/api/{cmd}"))
        .add_header("authorization", format!("Bearer {TOKEN}"));
    if let Some(key) = key {
        req = req.add_header("x-codeg-idempotency-key", key.to_string());
    }
    let resp = req.json(&args).await;
    let status = resp.status_code().as_u16();
    let text = resp.text();
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

async fn conversation_count(server: &TestServer) -> usize {
    let (status, list) = call(server, "list_all_conversations", json!({}), None).await;
    assert_eq!(status, 200, "{list}");
    list.as_array().expect("list").len()
}

#[tokio::test]
async fn a_repeated_call_runs_once() {
    let (server, _d, _s) = build_server().await;
    let (status, folder) = call(
        &server,
        "open_folder",
        json!({ "path": "/tmp/codeg-idempotency-calls" }),
        None,
    )
    .await;
    assert_eq!(status, 200, "{folder}");
    let create = json!({ "folderId": folder["id"], "agentType": "claude_code", "title": "t" });

    let first = call(
        &server,
        "create_conversation",
        create.clone(),
        Some("key-1"),
    )
    .await;
    assert_eq!(first.0, 200, "{}", first.1);
    let again = call(
        &server,
        "create_conversation",
        create.clone(),
        Some("key-1"),
    )
    .await;
    assert_eq!(again, first, "the same answer, not a second row");
    assert_eq!(conversation_count(&server).await, 1);

    // Two at once with a new key: one runs, the other waits for it.
    let (a, b) = tokio::join!(
        call(
            &server,
            "create_conversation",
            create.clone(),
            Some("key-2")
        ),
        call(
            &server,
            "create_conversation",
            create.clone(),
            Some("key-2")
        ),
    );
    assert_eq!(a, b);
    assert_ne!(a.1, first.1);
    assert_eq!(conversation_count(&server).await, 2);

    // Without a key, or with another, a call runs as always.
    call(&server, "create_conversation", create.clone(), None).await;
    call(&server, "create_conversation", create, Some("key-3")).await;
    assert_eq!(conversation_count(&server).await, 4);
}

#[tokio::test]
async fn a_key_belongs_to_its_path_and_keeps_errors_too() {
    let (server, _d, _s) = build_server().await;
    let missing = call(
        &server,
        "get_folder",
        json!({ "folderId": 4242 }),
        Some("same"),
    )
    .await;
    let again = call(
        &server,
        "get_folder",
        json!({ "folderId": 4242 }),
        Some("same"),
    )
    .await;
    assert_eq!(missing, again);
    let other = call(&server, "list_folder_groups", json!({}), Some("same")).await;
    assert_eq!(other.0, 200, "another path with the same key runs");
}
