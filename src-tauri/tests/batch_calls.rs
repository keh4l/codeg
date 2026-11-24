//! `POST /api/batch` (fork): a batched call answers exactly what the call
//! alone would — status, body, error — and a batch cannot hold a batch or be
//! sent without credentials.

use std::sync::Arc;

use axum_test::TestServer;
use codeg_lib::app_state::AppState;
use codeg_lib::db::test_helpers::fresh_in_memory_db;
use codeg_lib::web::router::build_router;
use codeg_lib::web::shutdown::ShutdownSignal;
use serde_json::{json, Value};

const TOKEN: &str = "batch-calls-token";

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

async fn alone(server: &TestServer, cmd: &str, args: Value) -> (u16, Value) {
    let resp = server
        .post(&format!("/api/{cmd}"))
        .add_header("authorization", format!("Bearer {TOKEN}"))
        .json(&args)
        .await;
    let status = resp.status_code().as_u16();
    let text = resp.text();
    let body = if text.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };
    (status, body)
}

#[tokio::test]
async fn batched_calls_answer_as_they_would_alone() {
    let (server, _d, _s) = build_server().await;
    let folder = alone(&server, "open_folder", json!({ "path": "/tmp/codeg-batch-calls" })).await;
    assert_eq!(folder.0, 200, "{}", folder.1);

    let calls = json!([
        { "cmd": "list_all_folder_details", "args": {} },
        { "cmd": "list_all_conversations", "args": {} },
        { "cmd": "get_tab_sync_settings" },
        { "cmd": "get_folder", "args": { "folderId": 987654 } },
        { "cmd": "no_such_command", "args": {} },
        { "cmd": "batch", "args": { "calls": [] } },
        { "cmd": "../health", "args": {} },
    ]);
    let resp = server
        .post("/api/batch")
        .add_header("authorization", format!("Bearer {TOKEN}"))
        .json(&json!({ "calls": calls }))
        .await;
    assert_eq!(resp.status_code(), 200, "{}", resp.text());
    let results: Value = resp.json();
    let results = results["results"].as_array().expect("results").clone();
    assert_eq!(results.len(), 7);

    for (i, (cmd, args)) in [
        ("list_all_folder_details", json!({})),
        ("list_all_conversations", json!({})),
        ("get_tab_sync_settings", json!({})),
        ("get_folder", json!({ "folderId": 987654 })),
        ("no_such_command", json!({})),
    ]
    .into_iter()
    .enumerate()
    {
        let (status, body) = alone(&server, cmd, args).await;
        assert_eq!(results[i]["s"], status, "{cmd}: {}", results[i]);
        assert_eq!(results[i]["b"], body, "{cmd}");
    }
    assert_eq!(results[4]["s"], 501, "an unknown command, as alone");
    for refused in [5, 6] {
        assert_eq!(results[refused]["s"], 400, "{}", results[refused]);
    }
}

#[tokio::test]
async fn a_batch_needs_credentials_like_any_call() {
    let (server, _d, _s) = build_server().await;
    let resp = server
        .post("/api/batch")
        .json(&json!({ "calls": [{ "cmd": "list_all_conversations" }] }))
        .await;
    assert_eq!(resp.status_code(), 401);
}
