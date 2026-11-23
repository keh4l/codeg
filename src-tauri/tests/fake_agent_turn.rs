//! End to end through a real agent process (fork): codeg spawns
//! `codeg-fake-acp` as a custom agent, and this test drives it the way the web
//! client does — HTTP calls plus the `/ws/events` attach stream. It covers
//! what the in-process wire budgets cannot: codeg's translation of an agent's
//! ACP output into events, permission round trips, and cancelling a stream.
//!
//! Unix only (PATH handling), and only with `fake-agent-bin`, which builds the
//! agent this test launches. It sets process-wide environment (`CODEG_HOME`,
//! `PATH`), so it must stay the only test in this file.
#![cfg(all(unix, feature = "fake-agent-bin"))]

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum_test::{TestServer, TestWebSocket};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use codeg_lib::app_state::AppState;
use codeg_lib::db::test_helpers::fresh_in_memory_db;
use codeg_lib::web::router::build_router;
use codeg_lib::web::shutdown::ShutdownSignal;
use serde_json::{json, Value};

const TOKEN: &str = "fake-agent-token";

async fn call(server: &TestServer, cmd: &str, body: Value) -> Value {
    let resp = server
        .post(&format!("/api/{cmd}"))
        .add_header("authorization", format!("Bearer {TOKEN}"))
        .json(&body)
        .await;
    assert!(
        resp.status_code().is_success(),
        "{cmd} -> {}: {}",
        resp.status_code(),
        resp.text()
    );
    let text = resp.text();
    if text.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    }
}

async fn next_frame(ws: &mut TestWebSocket, deadline: Instant) -> Value {
    let left = deadline.saturating_duration_since(Instant::now());
    let text = tokio::time::timeout(left, ws.receive_text())
        .await
        .expect("frame before the deadline");
    serde_json::from_str(&text).expect("json frame")
}

/// Envelopes from `event` and `replay` frames of subscription `sub`.
fn envelopes(frame: &Value, sub: &str) -> Vec<Value> {
    if frame["subscription_id"] != sub {
        return Vec::new();
    }
    match frame["type"].as_str() {
        Some("event") => vec![frame["envelope"].clone()],
        Some("replay") => frame["events"].as_array().cloned().unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Read until `stop` matches an envelope; returns everything seen.
async fn read_until(
    ws: &mut TestWebSocket,
    sub: &str,
    secs: u64,
    stop: impl Fn(&Value) -> bool,
) -> Vec<Value> {
    let deadline = Instant::now() + Duration::from_secs(secs);
    let mut seen = Vec::new();
    loop {
        let frame = next_frame(ws, deadline).await;
        for env in envelopes(&frame, sub) {
            let done = stop(&env);
            seen.push(env);
            if done {
                return seen;
            }
        }
    }
}

fn is_turn_complete(env: &Value) -> bool {
    env["type"] == "turn_complete"
}

fn streamed_text(events: &[Value]) -> String {
    events
        .iter()
        .filter(|e| e["type"] == "content_delta")
        .filter_map(|e| e["text"].as_str())
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fake_agent_connect_prompt_permission_cancel() {
    // Isolate everything codeg writes (caches, transcripts) and put the agent
    // on PATH where a custom binary agent with nothing cached is looked up.
    let home = tempfile::tempdir().expect("home");
    let bin_dir = home.path().join("bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    std::fs::copy(
        env!("CARGO_BIN_EXE_codeg-fake-acp"),
        bin_dir.join("codeg-fake-acp"),
    )
    .expect("copy fake agent");
    std::env::set_var("CODEG_HOME", home.path().join("codeg"));
    std::env::set_var(
        "PATH",
        format!(
            "{}:{}",
            bin_dir.display(),
            std::env::var("PATH").unwrap_or_default()
        ),
    );
    let workdir = home.path().join("repo");
    std::fs::create_dir_all(&workdir).unwrap();

    let data_dir = tempfile::tempdir().expect("data dir");
    let static_dir = tempfile::tempdir().expect("static dir");
    let db = fresh_in_memory_db().await;
    let state = Arc::new(AppState::new_for_test(db, data_dir.path().to_path_buf()));
    let router = build_router(
        Arc::clone(&state),
        TOKEN.to_string(),
        static_dir.path().to_path_buf(),
        Arc::new(ShutdownSignal::new()),
    );
    let server = TestServer::builder()
        .http_transport()
        .build(router)
        .expect("server");

    let platform = if cfg!(target_arch = "aarch64") {
        if cfg!(target_os = "macos") {
            "darwin-aarch64"
        } else {
            "linux-aarch64"
        }
    } else if cfg!(target_os = "macos") {
        "darwin-x86_64"
    } else {
        "linux-x86_64"
    };
    call(
        &server,
        "acp_save_custom_agent",
        json!({ "params": {
            "registryId": "fake-acp",
            "name": "Fake ACP",
            "version": "0.1.0",
            "distributionKind": "binary",
            "spec": { "binary": { platform: {
                "archive": "https://example.invalid/codeg-fake-acp.tar.gz",
                "cmd": "codeg-fake-acp",
                "env": { "FAKE_ACP_TIME_SCALE": "0.05", "FAKE_ACP_LOAD_MS": "1500" },
            } } },
        } }),
    )
    .await;
    let agents = call(&server, "acp_list_agents", json!({})).await;
    let agent = agents
        .as_array()
        .expect("agents")
        .iter()
        .find(|a| a["agent_type"] == "custom:fake-acp")
        .cloned()
        .expect("fake agent listed");
    assert_eq!(agent["installed_version"], "0.1.0", "{agent}");

    let folder = call(
        &server,
        "open_folder",
        json!({ "path": workdir.to_string_lossy() }),
    )
    .await;
    let connection_id = call(
        &server,
        "acp_connect",
        json!({
            "agentType": "custom:fake-acp",
            "workingDir": workdir.to_string_lossy(),
            "sessionId": null,
            "preferredModeId": null,
            "preferredConfigValues": null,
        }),
    )
    .await
    .as_str()
    .expect("connection id")
    .to_string();

    let mut ws = server
        .get_websocket("/ws/events")
        .add_header(
            "sec-websocket-protocol",
            format!(
                "codeg-events, codeg-token.{}",
                URL_SAFE_NO_PAD.encode(TOKEN)
            ),
        )
        .await
        .into_websocket()
        .await;
    let ready = next_frame(&mut ws, Instant::now() + Duration::from_secs(5)).await;
    assert_eq!(ready["channel"], "__ready__");
    ws.send_json(&json!({
        "action": "attach",
        "subscription_id": "s",
        "connection_id": connection_id,
        "since_seq": null,
    }))
    .await;
    let snapshot = next_frame(&mut ws, Instant::now() + Duration::from_secs(5)).await;
    assert_eq!(snapshot["type"], "snapshot", "{snapshot}");

    // Wait for the session to come up before prompting.
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let snap = call(
            &server,
            "acp_get_session_snapshot",
            json!({ "connectionId": connection_id }),
        )
        .await;
        if snap["status"] == "connected" {
            break;
        }
        assert!(Instant::now() < deadline, "agent never connected: {snap}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let prompt = |text: &str| {
        json!({
            "connectionId": connection_id,
            "blocks": [{ "type": "text", "text": text }],
            "folderId": folder["id"],
            "conversationId": null,
            "clientMessageId": null,
        })
    };

    // 1. A whole scripted turn arrives, in order, as text, tools and plan.
    call(&server, "acp_prompt", prompt("@scenario budget-turn")).await;
    let turn = read_until(&mut ws, "s", 30, is_turn_complete).await;
    let text = streamed_text(&turn);
    assert!(
        text.chars().count() >= 3000,
        "streamed {} chars",
        text.chars().count()
    );
    for kind in [
        "thinking",
        "tool_call",
        "tool_call_update",
        "plan_update",
        "usage_update",
    ] {
        assert!(
            turn.iter().any(|e| e["type"] == kind),
            "no {kind} in the turn"
        );
    }
    let seqs: Vec<u64> = turn.iter().filter_map(|e| e["seq"].as_u64()).collect();
    assert!(
        seqs.windows(2).all(|w| w[0] < w[1]),
        "seq strictly increasing"
    );
    let turn_bytes: usize = turn.iter().map(|e| e.to_string().len()).sum();
    println!(
        "budget-turn through a real agent: {} envelopes, {} bytes, {} chars streamed",
        turn.len(),
        turn_bytes,
        text.chars().count()
    );

    // 2. A permission request round-trips; a duplicate answer is harmless.
    call(&server, "acp_prompt", prompt("@scenario permission")).await;
    let asked = read_until(&mut ws, "s", 20, |e| e["type"] == "permission_request").await;
    let request = asked.last().unwrap();
    let request_id = request["request_id"]
        .as_str()
        .expect("request id")
        .to_string();
    for _ in 0..2 {
        let _ = server
            .post("/api/acp_respond_permission")
            .add_header("authorization", format!("Bearer {TOKEN}"))
            .json(&json!({ "connectionId": connection_id, "requestId": request_id, "optionId": "allow" }))
            .await;
    }
    let after = read_until(&mut ws, "s", 20, is_turn_complete).await;
    assert!(
        streamed_text(&after).contains("已删除"),
        "allowed branch ran: {:?}",
        streamed_text(&after)
    );

    // 3. Cancelling a long stream ends the turn as cancelled, promptly.
    call(&server, "acp_prompt", prompt("@scenario long-idle")).await;
    read_until(&mut ws, "s", 20, |e| e["type"] == "content_delta").await;
    let cancelled_at = Instant::now();
    call(
        &server,
        "acp_cancel",
        json!({ "connectionId": connection_id }),
    )
    .await;
    let end = read_until(&mut ws, "s", 20, is_turn_complete).await;
    let complete = end.last().unwrap();
    assert_eq!(complete["stop_reason"], "cancelled", "{complete}");
    assert!(
        cancelled_at.elapsed() < Duration::from_secs(5),
        "cancel took {:?}",
        cancelled_at.elapsed()
    );

    // 4. (fork) `acp_open_session` resuming a session: the new connection
    // comes back while the agent is still loading it (1.5 s here), and a
    // second open for the same session, sent meanwhile, waits for the load and
    // gets that same connection back instead of a second agent.
    let session_id = call(
        &server,
        "acp_get_session_snapshot",
        json!({ "connectionId": connection_id }),
    )
    .await["external_id"]
    .as_str()
    .expect("session id")
    .to_string();
    let _ = call(
        &server,
        "acp_disconnect",
        json!({ "connectionId": connection_id }),
    )
    .await;
    let open = json!({
        "agentType": "custom:fake-acp",
        "workingDir": workdir.to_string_lossy(),
        "sessionId": session_id,
    });
    let opened_at = Instant::now();
    let first = call(&server, "acp_open_session", open.clone()).await;
    let first_took = opened_at.elapsed();
    assert_eq!(first["outcome"], "spawned", "{first}");
    assert!(
        first_took < Duration::from_millis(1200),
        "came back after the load: {first_took:?}"
    );
    let resumed = first["connection_id"].as_str().expect("id").to_string();
    // Still loading: the session is not bound to the connection yet.
    let loading = call(
        &server,
        "acp_get_session_snapshot",
        json!({ "connectionId": resumed }),
    )
    .await;
    assert!(loading["external_id"].is_null(), "{loading}");
    let second = call(&server, "acp_open_session", open).await;
    assert_eq!(second["outcome"], "reused", "{second}");
    assert_eq!(second["connection_id"], first["connection_id"]);
    let snap = call(
        &server,
        "acp_get_session_snapshot",
        json!({ "connectionId": resumed }),
    )
    .await;
    assert_eq!(snap["status"], "connected", "{snap}");
    assert_eq!(snap["external_id"], session_id.as_str());
    println!(
        "open_session resume: answered in {first_took:?}, the second open after {:?}",
        opened_at.elapsed()
    );

    let _ = call(
        &server,
        "acp_disconnect",
        json!({ "connectionId": resumed }),
    )
    .await;
}
