//! Wire budgets (fork): how many frames and bytes the web client receives for
//! the things a remote user does all day — streaming a turn, attaching to a
//! live conversation, reconnecting, opening a conversation with screenshots.
//!
//! Each budget is the measured value plus headroom. A change that makes any of
//! them bigger fails here with measured vs budget, so a regression on a slow
//! link (370 ms RTT, 7% loss is what the fork's users run) is caught in the
//! gate instead of by feel. The remote-performance work lowers them step by
//! step; when a change legitimately lowers a number, lower its budget too.
//!
//! `CODEG_WIRE_BUDGET_REPORT=<path>` writes every measurement as JSON;
//! `cargo test --test wire_budget -- --nocapture` prints the table.
//!
//! Counted bytes are WebSocket message payloads and HTTP bodies as sent, not
//! TCP bytes. Protocol v1 (`codeg-events`) is uncompressed; where a budget
//! says v2 (`codeg-events.v2`), it counts the compressed binary parts.

use std::collections::BTreeMap;
use std::io::Write as _;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum_test::{TestServer, TestWebSocket};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use codeg_lib::acp::types::{AcpEvent, PlanEntryInfo};
use codeg_lib::app_state::AppState;
use codeg_lib::db::test_helpers::fresh_in_memory_db;
use codeg_lib::models::agent::AgentType;
use codeg_lib::web::event_bridge::emit_with_state;
use codeg_lib::web::router::build_router;
use codeg_lib::web::shutdown::ShutdownSignal;
use serde_json::{json, Value};

const TOKEN: &str = "wire-budget-token";

/// One measurement: what was measured, its value, and the budget it must stay
/// under.
struct Measured {
    name: &'static str,
    value: u64,
    budget: u64,
}

static REPORT: Mutex<Vec<(String, u64, u64)>> = Mutex::new(Vec::new());

fn check(items: &[Measured]) {
    let mut failures = Vec::new();
    for m in items {
        println!("{:<58} {:>10} / {:>10}", m.name, m.value, m.budget);
        REPORT
            .lock()
            .unwrap()
            .push((m.name.to_string(), m.value, m.budget));
        if m.value > m.budget {
            failures.push(format!(
                "{}: measured {} > budget {}",
                m.name, m.value, m.budget
            ));
        }
    }
    if let Ok(path) = std::env::var("CODEG_WIRE_BUDGET_REPORT") {
        let rows: BTreeMap<String, Value> = REPORT
            .lock()
            .unwrap()
            .iter()
            .map(|(n, v, b)| (n.clone(), json!({ "value": v, "budget": b })))
            .collect();
        let _ = std::fs::write(path, serde_json::to_string_pretty(&rows).unwrap());
    }
    assert!(failures.is_empty(), "over budget:\n{}", failures.join("\n"));
}

/// Every test's blob store (fork): one directory for the process, under the
/// target dir, so nothing is written into the real data root. Set before any
/// test can open the store on its default path.
fn use_test_blob_store() {
    let dir = std::path::PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("wire-budget-blobs");
    codeg_lib::web::blob_store::init_global(dir).expect("blob store");
}

async fn build_server() -> (
    TestServer,
    Arc<AppState>,
    tempfile::TempDir,
    tempfile::TempDir,
) {
    use_test_blob_store();
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
        .expect("test server");
    (server, state, data_dir, static_dir)
}

async fn open_ws(server: &TestServer) -> TestWebSocket {
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
    let ready = next_text(&mut ws).await;
    assert!(ready.contains("__ready__"), "first frame: {ready}");
    ws
}

/// A socket on protocol v2 (fork): large frames compressed in parts.
async fn open_ws_v2(server: &TestServer) -> TestWebSocket {
    let response = server
        .get_websocket("/ws/events")
        .add_header(
            "sec-websocket-protocol",
            format!(
                "codeg-events.v2, codeg-events, codeg-token.{}",
                URL_SAFE_NO_PAD.encode(TOKEN)
            ),
        )
        .await;
    assert_eq!(response.header("sec-websocket-protocol"), "codeg-events.v2");
    let mut ws = response.into_websocket().await;
    let ready = next_text(&mut ws).await;
    assert!(ready.contains("__ready__"), "first frame: {ready}");
    ws
}

/// The next v2 frame and the bytes it took on the wire.
async fn next_frame_v2(ws: &mut TestWebSocket) -> (Value, u64) {
    use axum_test::WsMessage;
    use std::io::Read as _;

    let mut stream = Vec::new();
    let mut wire = 0u64;
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), ws.receive_message())
            .await
            .expect("ws message within 5s");
        match message {
            WsMessage::Text(text) if stream.is_empty() => {
                let len = text.len() as u64;
                return (serde_json::from_str(&text).expect("json frame"), len);
            }
            WsMessage::Binary(bytes) => {
                wire += bytes.len() as u64;
                stream.extend_from_slice(&bytes[1..]);
                if bytes[0] != 0x02 {
                    break;
                }
            }
            other => panic!("unexpected {other:?}"),
        }
    }
    let mut json = String::new();
    flate2::read::ZlibDecoder::new(&stream[..])
        .read_to_string(&mut json)
        .expect("zlib frame");
    (serde_json::from_str(&json).expect("json frame"), wire)
}

async fn next_text(ws: &mut TestWebSocket) -> String {
    tokio::time::timeout(Duration::from_secs(5), ws.receive_text())
        .await
        .expect("ws frame within 5s")
}

async fn attach(ws: &mut TestWebSocket, sub: &str, conn: &str, since: Option<u64>) -> (Value, u64) {
    ws.send_json(&json!({
        "action": "attach",
        "subscription_id": sub,
        "connection_id": conn,
        "since_seq": since,
    }))
    .await;
    let text = next_text(ws).await;
    let len = text.len() as u64;
    (serde_json::from_str(&text).expect("json frame"), len)
}

/// Deterministic prose, `n` characters.
fn prose(seed: u64, n: usize) -> String {
    const WORDS: &[&str] = &[
        "登录", "表单", "校验", "逻辑", "后端", "接口", "返回", "错误", "提示", "字段", "the",
        "request", "handler", "schema", "cache", "state", "`zod`", "`fetch`",
    ];
    let mut x = seed | 1;
    let mut s = String::new();
    while s.chars().count() < n {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        s.push_str(WORDS[(x % WORDS.len() as u64) as usize]);
        s.push(if x.is_multiple_of(9) { '\n' } else { ' ' });
    }
    s.chars().take(n).collect()
}

/// `text` as the 18-character chunks a model streams.
fn chunks(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    chars.chunks(18).map(|c| c.iter().collect()).collect()
}

fn tool_output(lines: usize) -> String {
    (1..=lines)
        .map(|i| format!("{i:>5}  {}\n", prose(i as u64, 60)))
        .collect()
}

fn plan(done: usize) -> AcpEvent {
    AcpEvent::PlanUpdate {
        entries: ["read", "edit", "test"]
            .iter()
            .enumerate()
            .map(|(i, c)| PlanEntryInfo {
                content: (*c).to_string(),
                priority: "medium".into(),
                status: if i < done {
                    "completed"
                } else if i == done {
                    "in_progress"
                } else {
                    "pending"
                }
                .into(),
            })
            .collect(),
    }
}

fn tool_call(id: &str, title: &str, kind: &str, input: Value) -> AcpEvent {
    AcpEvent::ToolCall {
        tool_call_id: id.into(),
        title: title.into(),
        kind: kind.into(),
        status: "in_progress".into(),
        content: None,
        raw_input: Some(input.to_string()),
        raw_output: None,
        locations: None,
        meta: None,
        images: None,
    }
}

fn tool_done(id: &str, output: &str) -> AcpEvent {
    AcpEvent::ToolCallUpdate {
        tool_call_id: id.into(),
        title: None,
        status: Some("completed".into()),
        content: Some(output.to_string()),
        raw_input: None,
        raw_output: Some(json!({ "output": output }).to_string()),
        raw_output_append: None,
        locations: None,
        meta: None,
        images: None,
    }
}

/// The fixed turn every streaming budget measures: a plan, 600 characters of
/// thinking, a Read (200 lines), 1500 characters of reply, a Bash (80 lines),
/// 1500 more, usage, turn complete — 4.2 KB of text in 18-character chunks,
/// the way a model streams. Mirrors `codeg-fake-acp`'s `budget-turn`.
fn budget_turn() -> Vec<AcpEvent> {
    let mut events = vec![plan(0)];
    for c in chunks(&prose(1, 600)) {
        events.push(AcpEvent::Thinking {
            text: c,
            parent_tool_use_id: None,
        });
    }
    events.push(tool_call(
        "read-1",
        "Read src/auth/schema.ts",
        "read",
        json!({ "file_path": "src/auth/schema.ts" }),
    ));
    events.push(tool_done("read-1", &tool_output(200)));
    events.push(plan(1));
    for c in chunks(&prose(2, 1500)) {
        events.push(AcpEvent::ContentDelta {
            text: c,
            parent_tool_use_id: None,
        });
    }
    events.push(tool_call(
        "bash-1",
        "pnpm test src/auth",
        "execute",
        json!({ "command": "pnpm test src/auth" }),
    ));
    events.push(tool_done("bash-1", &tool_output(80)));
    events.push(plan(3));
    for c in chunks(&prose(3, 1500)) {
        events.push(AcpEvent::ContentDelta {
            text: c,
            parent_tool_use_id: None,
        });
    }
    events.push(AcpEvent::UsageUpdate {
        used: 18_000,
        size: 200_000,
    });
    events.push(AcpEvent::TurnComplete {
        session_id: "s".into(),
        stop_reason: "end_turn".into(),
        agent_type: "claude_code".into(),
    });
    events
}

async fn emit_all(state: &Arc<AppState>, conn: &str, events: Vec<AcpEvent>) {
    let session = state
        .connection_manager
        .get_state(conn)
        .await
        .expect("registered connection");
    for event in events {
        emit_with_state(&session, &state.emitter, event).await;
    }
}

/// Emit like a streaming agent: one event every `gap`, which is what lets
/// the live stream merge text (it merges what arrives within a window of the
/// last frame, so a burst is not what a user sees).
async fn emit_paced(state: &Arc<AppState>, conn: &str, events: Vec<AcpEvent>, gap: Duration) {
    let session = state
        .connection_manager
        .get_state(conn)
        .await
        .expect("registered connection");
    for event in events {
        emit_with_state(&session, &state.emitter, event).await;
        tokio::time::sleep(gap).await;
    }
}

async fn new_connection(state: &Arc<AppState>, conn: &str) {
    state
        .connection_manager
        .insert_test_connection(conn, AgentType::ClaudeCode, None, state.emitter.clone())
        .await;
}

async fn head_seq(state: &Arc<AppState>, conn: &str) -> u64 {
    state
        .connection_manager
        .get_state(conn)
        .await
        .expect("conn")
        .read()
        .await
        .event_seq
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming one turn to an attached client.
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn streaming_turn_frames_and_bytes() {
    let (server, state, _d, _s) = build_server().await;
    new_connection(&state, "turn").await;
    let mut ws = open_ws(&server).await;
    let (snapshot, _) = attach(&mut ws, "sub", "turn", None).await;
    assert_eq!(snapshot["type"], "snapshot");

    let events = budget_turn();
    let emitted = events.len() as u64;
    let text_chars: usize = events
        .iter()
        .map(|e| match e {
            AcpEvent::ContentDelta { text, .. } | AcpEvent::Thinking { text, .. } => {
                text.chars().count()
            }
            _ => 0,
        })
        .sum();
    let reply: String = events
        .iter()
        .filter_map(|e| match e {
            AcpEvent::ContentDelta { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    // About 50 chunks a second, the rate of a fast model's reply.
    let emitter = {
        let state = Arc::clone(&state);
        tokio::spawn(
            async move { emit_paced(&state, "turn", events, Duration::from_millis(20)).await },
        )
    };

    let (mut frames, mut bytes) = (0u64, 0u64);
    let mut received = String::new();
    loop {
        let text = next_text(&mut ws).await;
        frames += 1;
        bytes += text.len() as u64;
        let frame: Value = serde_json::from_str(&text).expect("json frame");
        if frame["envelope"]["type"] == "content_delta" {
            received.push_str(frame["envelope"]["text"].as_str().unwrap_or_default());
        }
        if text.contains("\"turn_complete\"") {
            break;
        }
    }
    emitter.await.unwrap();
    assert!(frames > 0 && emitted > 0);
    assert_eq!(received, reply, "merging loses or reorders no text");
    check(&[
        Measured {
            name: "turn: ws frames",
            value: frames,
            // Paced in real time, so a loaded machine can split a merge:
            // more headroom than the byte budgets.
            budget: 64,
        },
        Measured {
            name: "turn: ws frames per 1000 streamed chars",
            value: frames * 1000 / text_chars as u64,
            budget: 17,
        },
        Measured {
            name: "turn: ws bytes",
            value: bytes,
            budget: 79_000,
        },
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Attaching to a live turn that carries big tool output (the 1.7 MB snapshot
// measured on the production server was 930 KB of tool-call content).
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn cold_attach_snapshot_with_big_tool_output() {
    let (server, state, _d, _s) = build_server().await;
    new_connection(&state, "big").await;
    let mut events = Vec::new();
    for i in 0..60 {
        let id = format!("bash-{i}");
        events.push(tool_call(
            &id,
            "pnpm test",
            "execute",
            json!({ "command": "pnpm test" }),
        ));
        events.push(tool_done(&id, &tool_output(200)));
    }
    for c in chunks(&prose(9, 3000)) {
        events.push(AcpEvent::ContentDelta {
            text: c,
            parent_tool_use_id: None,
        });
    }
    emit_all(&state, "big", events).await;

    let mut ws = open_ws(&server).await;
    let (frame, bytes) = attach(&mut ws, "sub", "big", None).await;
    assert_eq!(frame["type"], "snapshot");

    // The same attach on protocol v2: compressed, in parts.
    let mut v2 = open_ws_v2(&server).await;
    v2.send_json(&json!({
        "action": "attach",
        "subscription_id": "sub",
        "connection_id": "big",
        "since_seq": null,
    }))
    .await;
    let (v2_frame, v2_bytes) = next_frame_v2(&mut v2).await;
    assert_eq!(v2_frame, frame, "v2 carries the same frame");

    // And for a client that reads `wire: 2` (fork, 2.7): the duplicate
    // `content` gone, the older outputs shortened, each a request away whole.
    let mut slim = open_ws_v2(&server).await;
    slim.send_json(&json!({
        "action": "attach",
        "subscription_id": "sub",
        "connection_id": "big",
        "since_seq": null,
        "wire": 2,
    }))
    .await;
    let (slim_frame, slim_bytes) = next_frame_v2(&mut slim).await;
    assert_eq!(slim_frame["type"], "snapshot");
    assert_eq!(slim_frame["event_seq"], frame["event_seq"]);
    let full_calls = frame["snapshot"]["active_tool_calls"].as_array().expect("calls");
    let slim_calls = slim_frame["snapshot"]["active_tool_calls"]
        .as_array()
        .expect("calls");
    assert_eq!(slim_calls.len(), full_calls.len(), "every call is there");
    let shortened: Vec<(&Value, &Value)> = slim_calls
        .iter()
        .zip(full_calls)
        .filter(|(slim, _)| slim["body_refs"]["output"].is_object())
        .collect();
    assert!(!shortened.is_empty(), "older outputs are shortened");
    let (slim_call, full_call) = shortened[0];
    let full_text = match full_call["output"]["kind"].as_str() {
        Some("text") => full_call["output"]["content"].as_str().unwrap().to_string(),
        _ => full_call["output"]["value"].to_string(),
    };
    let blob = server
        .post("/api/get_blob_text")
        .add_header("authorization", format!("Bearer {TOKEN}"))
        .json(&json!({ "id": slim_call["body_refs"]["output"]["id"] }))
        .await;
    assert_eq!(blob.status_code(), 200, "{}", blob.text());
    let blob: Value = blob.json();
    assert_eq!(blob["text"].as_str(), Some(full_text.as_str()), "the full text");
    let unauthenticated = server
        .post("/api/get_blob_text")
        .json(&json!({ "id": slim_call["body_refs"]["output"]["id"] }))
        .await;
    assert_eq!(unauthenticated.status_code(), 401);
    let slim_json = slim_frame.to_string().len() as u64;
    check(&[
        Measured {
            name: "cold attach: snapshot bytes (60 tool calls x 14 KB)",
            value: bytes,
            budget: 2_355_000,
        },
        Measured {
            name: "cold attach on v2: wire bytes (zlib)",
            value: v2_bytes,
            budget: V2_SNAPSHOT_BUDGET,
        },
        Measured {
            name: "cold attach, wire 2: snapshot JSON bytes",
            value: slim_json,
            budget: SLIM_SNAPSHOT_JSON_BUDGET,
        },
        Measured {
            name: "cold attach on v2, wire 2: wire bytes (zlib)",
            value: slim_bytes,
            budget: SLIM_SNAPSHOT_BUDGET,
        },
    ]);
}

/// The same snapshot for a `wire: 2` client (fork, 2.7): 497 KB of JSON,
/// 15 KB in zlib (measured + 10%; the fixture's outputs repeat, so zlib does
/// better here than on a real turn).
const SLIM_SNAPSHOT_JSON_BUDGET: u64 = 547_000;
const SLIM_SNAPSHOT_BUDGET: u64 = 17_000;

// ─────────────────────────────────────────────────────────────────────────────
/// v2 cold attach of the snapshot above (2.14 MB of JSON): 285 KB in zlib.
const V2_SNAPSHOT_BUDGET: u64 = 313_000;

// ─────────────────────────────────────────────────────────────────────────────
// Reconnecting: a client that saw everything, and one that missed 40 events.
// Both are replays: empty, and the 40 chunks merged into one envelope.
// ─────────────────────────────────────────────────────────────────────────────

/// A turn still running: 20 commands with 200 lines of output each, then a
/// stream of reply text — what a reconnect lands in mid-turn.
fn live_turn_with_tools() -> Vec<AcpEvent> {
    let mut events = Vec::new();
    for i in 0..20 {
        let id = format!("bash-{i}");
        events.push(tool_call(
            &id,
            "pnpm test",
            "execute",
            json!({ "command": "pnpm test" }),
        ));
        events.push(tool_done(&id, &tool_output(200)));
    }
    for c in chunks(&prose(7, 1500)) {
        events.push(AcpEvent::ContentDelta {
            text: c,
            parent_tool_use_id: None,
        });
    }
    events
}

#[tokio::test]
async fn reattach_mid_turn_when_caught_up_and_after_short_gap() {
    let (server, state, _d, _s) = build_server().await;
    new_connection(&state, "re").await;
    emit_all(&state, "re", live_turn_with_tools()).await;
    let head = head_seq(&state, "re").await;

    // The client saw everything (an idle reconnect, a laptop waking up).
    let mut ws = open_ws(&server).await;
    let (caught_up, caught_up_bytes) = attach(&mut ws, "a", "re", Some(head)).await;

    // 40 more chunks while it was away (about 2.4 s of streaming).
    emit_all(
        &state,
        "re",
        chunks(&prose(5, 40 * 18))
            .into_iter()
            .map(|c| AcpEvent::ContentDelta {
                text: c,
                parent_tool_use_id: None,
            })
            .collect(),
    )
    .await;
    let mut ws2 = open_ws(&server).await;
    let (gap, gap_bytes) = attach(&mut ws2, "b", "re", Some(head)).await;

    println!(
        "mid-turn re-attach: caught up -> {}, 40-chunk gap -> {}",
        caught_up["type"], gap["type"]
    );
    // A client that missed nothing gets an empty replay, not the live turn.
    assert_eq!(caught_up["type"], "replay");
    // One that missed a few seconds of text gets that text, merged.
    assert_eq!(gap["type"], "replay");
    assert_eq!(gap["events"].as_array().map(Vec::len), Some(1));
    check(&[
        Measured {
            name: "re-attach mid-turn, nothing missed: bytes",
            value: caught_up_bytes,
            budget: 110,
        },
        Measured {
            name: "re-attach mid-turn, missed 40 chunks: bytes",
            value: gap_bytes,
            budget: 1_400,
        },
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Opening a conversation with screenshots: the default 120-turn window.
// ─────────────────────────────────────────────────────────────────────────────

/// A Claude Code transcript like the one `net-trace.mjs` seeds: 150 rounds,
/// a 150 KB (incompressible) screenshot every 15th round, a Bash call per
/// round with 40 lines of output.
fn write_claude_transcript(dir: &std::path::Path, cwd: &str, session: &str) {
    write_claude_rounds(dir, cwd, session, 150, true, |_| tool_output(40));
}

/// `rounds` rounds of a user message (a 150 KB screenshot every 15th when
/// `images`), a reply with a Bash call, its result `output(i)` and a closing
/// line.
fn write_claude_rounds(
    dir: &std::path::Path,
    cwd: &str,
    session: &str,
    rounds: u64,
    images: bool,
    output: impl Fn(u64) -> String,
) {
    let project = dir.join("projects").join(cwd.replace(['/', '.'], "-"));
    std::fs::create_dir_all(&project).expect("project dir");
    let mut file = std::fs::File::create(project.join(format!("{session}.jsonl"))).expect("file");
    let mut x: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut png = |n: usize| {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        while bytes.len() < n {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            bytes.extend_from_slice(&x.to_le_bytes());
        }
        bytes.truncate(n);
        base64::engine::general_purpose::STANDARD.encode(bytes)
    };
    let mut t = 0u64;
    let mut ts = || {
        t += 1;
        format!("2026-11-22T01:{:02}:{:02}.000Z", (t / 60) % 60, t % 60)
    };
    for i in 0..rounds {
        let mut content =
            vec![json!({ "type": "text", "text": format!("Round {i}: fix panel {i}") })];
        if images && i % 15 == 0 {
            content.push(json!({ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": png(150 * 1024) } }));
        }
        let lines = [
            json!({ "type": "user", "timestamp": ts(), "uuid": format!("u{i}"), "cwd": cwd,
                    "message": { "role": "user", "content": content } }),
            json!({ "type": "assistant", "timestamp": ts(), "uuid": format!("a{i}"), "parentUuid": format!("u{i}"),
                    "message": { "id": format!("m{i}"), "role": "assistant", "model": "claude-opus-5-5",
                                 "content": [
                                     { "type": "text", "text": prose(i, 400) },
                                     { "type": "tool_use", "id": format!("tu{i}"), "name": "Bash", "input": { "command": format!("rg -n panel{i} src") } },
                                 ] } }),
            json!({ "type": "user", "timestamp": ts(), "uuid": format!("r{i}"), "parentUuid": format!("a{i}"), "cwd": cwd,
                    "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": format!("tu{i}"), "content": output(i) }] } }),
            json!({ "type": "assistant", "timestamp": ts(), "uuid": format!("b{i}"), "parentUuid": format!("r{i}"),
                    "message": { "id": format!("n{i}"), "role": "assistant", "model": "claude-opus-5-5",
                                 "content": [{ "type": "text", "text": format!("Fixed panel {i}.") }] } }),
        ];
        for line in lines {
            writeln!(file, "{line}").expect("write line");
        }
    }
}

/// A Claude Code conversation bound to `session`, its transcript read from
/// `config_dir`.
async fn claude_conversation(
    state: &Arc<AppState>,
    config_dir: &std::path::Path,
    cwd: &str,
    session: &str,
) -> i32 {
    use codeg_lib::db::service::{agent_setting_service, conversation_service, folder_service};

    // Point Claude Code at the temp config dir through its agent settings, as
    // the settings page does — nothing here reads the real ~/.claude.
    agent_setting_service::ensure_defaults(
        &state.db.conn,
        &[agent_setting_service::AgentDefaultInput {
            agent_type: AgentType::ClaudeCode,
            registry_id: AgentType::ClaudeCode.to_string(),
            default_sort_order: 0,
        }],
    )
    .await
    .expect("agent defaults");
    agent_setting_service::update(
        &state.db.conn,
        AgentType::ClaudeCode,
        agent_setting_service::AgentSettingsUpdate {
            enabled: true,
            env_json: Some(json!({ "CLAUDE_CONFIG_DIR": config_dir }).to_string()),
            model_provider_id: None,
        },
    )
    .await
    .expect("agent env");
    let folder = folder_service::add_folder(&state.db.conn, cwd)
        .await
        .expect("folder");
    let conversation_id = codeg_lib::commands::conversations::create_conversation_core(
        &state.db.conn,
        folder.id,
        AgentType::ClaudeCode,
        Some("screenshots".into()),
    )
    .await
    .expect("conversation");
    conversation_service::bind_external_id(&state.db.conn, conversation_id, session, &[])
        .await
        .expect("bind session");

    conversation_id
}

#[tokio::test]
async fn opening_a_conversation_with_screenshots() {
    let (server, state, _d, _s) = build_server().await;
    let config_dir = tempfile::tempdir().expect("claude config dir");
    let cwd = "/tmp/codeg-wire-budget-proj";
    let session = "6b0e1c2d-3f4a-4b5c-8d6e-7f8091a2b3c4";
    write_claude_transcript(config_dir.path(), cwd, session);
    let conversation_id = claude_conversation(&state, config_dir.path(), cwd, session).await;

    let request = || {
        server
            .post("/api/get_folder_conversation")
            .add_header("authorization", format!("Bearer {TOKEN}"))
            .json(&json!({ "conversationId": conversation_id, "tailTurns": 120 }))
    };
    let plain = request().await;
    assert_eq!(plain.status_code(), 200, "{}", plain.text());
    let body: Value = plain.json();

    // The same window with images as references (fork, 2.3): the browser
    // loads each image once from /api/img/{id} and caches it for good.
    let with_refs = || {
        server
            .post("/api/get_folder_conversation")
            .add_header("authorization", format!("Bearer {TOKEN}"))
            .add_header("accept-encoding", "gzip")
            .json(
                &json!({ "conversationId": conversation_id, "tailTurns": 120, "imageRefs": true }),
            )
    };
    let refs = with_refs().await;
    assert_eq!(refs.status_code(), 200, "{}", refs.text());
    let refs_gzip = refs.as_bytes().len() as u64;
    let refs_body: Value = server
        .post("/api/get_folder_conversation")
        .add_header("authorization", format!("Bearer {TOKEN}"))
        .json(&json!({ "conversationId": conversation_id, "tailTurns": 120, "imageRefs": true }))
        .await
        .json();
    let first_ref = find_blob_id(&refs_body).expect("images became references");
    let image = server.get(&format!("/api/img/{first_ref}")).await;
    assert_eq!(image.status_code(), 200);
    assert_eq!(
        image
            .headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok()),
        Some("private, max-age=31536000, immutable")
    );
    let refs_longest = longest_string(&refs_body);

    // And with the first-window budget a remote client sends (fork, 2.6):
    // the last 8 rounds, at most 512 KiB.
    let budgeted = server
        .post("/api/get_folder_conversation")
        .add_header("authorization", format!("Bearer {TOKEN}"))
        .add_header("accept-encoding", "gzip")
        .json(&json!({
            "conversationId": conversation_id,
            "tailTurns": 120,
            "imageRefs": true,
            "windowMaxBytes": 512 * 1024,
            "windowMaxUserTurns": 8,
        }))
        .await;
    assert_eq!(budgeted.status_code(), 200, "{}", budgeted.text());
    let budgeted_gzip = budgeted.as_bytes().len() as u64;
    let budgeted_body: Value = server
        .post("/api/get_folder_conversation")
        .add_header("authorization", format!("Bearer {TOKEN}"))
        .json(&json!({
            "conversationId": conversation_id,
            "tailTurns": 120,
            "imageRefs": true,
            "windowMaxBytes": 512 * 1024,
            "windowMaxUserTurns": 8,
        }))
        .await
        .json();
    let budgeted_users = budgeted_body["turns"]
        .as_array()
        .map(|t| t.iter().filter(|t| t["role"] == "user").count())
        .unwrap_or(0);
    assert!(budgeted_users <= 8, "{budgeted_users} user turns");
    assert_eq!(budgeted_body["turns"][0]["role"], "user", "starts a round");
    let turns = body["turns"].as_array().map(|t| t.len()).unwrap_or(0);
    assert!(turns > 0, "window has turns");
    let longest_string = longest_string(&body);
    let gzip = request().add_header("accept-encoding", "gzip").await;
    assert_eq!(
        gzip.headers()
            .get("content-encoding")
            .and_then(|v| v.to_str().ok()),
        Some("gzip")
    );
    println!("window turns: {turns}");
    check(&[
        Measured {
            name: "open (120-turn window): json bytes",
            value: plain.as_bytes().len() as u64,
            budget: 693_500,
        },
        Measured {
            name: "open (120-turn window): gzip bytes on the wire",
            value: gzip.as_bytes().len() as u64,
            budget: 356_000,
        },
        Measured {
            name: "open with imageRefs: gzip bytes on the wire",
            value: refs_gzip,
            budget: REFS_GZIP_BUDGET,
        },
        Measured {
            name: "open with imageRefs + 8-round budget: gzip bytes",
            value: budgeted_gzip,
            budget: BUDGETED_GZIP_BUDGET,
        },
        Measured {
            name: "open with imageRefs: longest single string",
            value: refs_longest as u64,
            budget: REFS_LONGEST_BUDGET,
        },
        Measured {
            name: "open: longest single string (inlined image => huge)",
            value: longest_string as u64,
            budget: 225_300,
        },
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Opening a conversation whose commands printed a lot (fork, 2.8): each long
// tool output comes shortened, its full text a request away.
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn opening_a_conversation_with_long_tool_output() {
    let (server, state, _d, _s) = build_server().await;
    let config_dir = tempfile::tempdir().expect("claude config dir");
    let cwd = "/tmp/codeg-wire-budget-logs";
    let session = "7c1f2d3e-4a5b-4c6d-9e8f-a0b1c2d3e4f5";
    // 12 rounds, each printing 3000 lines (~200 KB).
    write_claude_rounds(config_dir.path(), cwd, session, 12, false, |_| {
        tool_output(3000)
    });
    let conversation_id = claude_conversation(&state, config_dir.path(), cwd, session).await;

    let fetch = |extra: Value, gzip: bool| {
        let mut body = json!({ "conversationId": conversation_id, "tailTurns": 120 });
        for (k, v) in extra.as_object().unwrap() {
            body[k] = v.clone();
        }
        let mut request = server
            .post("/api/get_folder_conversation")
            .add_header("authorization", format!("Bearer {TOKEN}"));
        if gzip {
            request = request.add_header("accept-encoding", "gzip");
        }
        request.json(&body)
    };
    let plain = fetch(json!({}), true).await;
    assert_eq!(plain.status_code(), 200, "{}", plain.text());
    let full: Value = fetch(json!({}), false).await.json();
    let short_gzip = fetch(json!({ "toolBodies": true }), true).await;
    assert_eq!(short_gzip.status_code(), 200);
    let short: Value = fetch(json!({ "toolBodies": true }), false).await.json();

    let results = |detail: &Value| -> Vec<Value> {
        detail["turns"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|t| t["blocks"].as_array().cloned().unwrap_or_default())
            .filter(|b| b["type"] == "tool_result")
            .collect()
    };
    let full_results = results(&full);
    let short_results = results(&short);
    assert_eq!(full_results.len(), 12);
    assert_eq!(short_results.len(), 12, "same turns, same blocks");
    let original = full_results[0]["output_preview"].as_str().unwrap();
    let shortened = &short_results[0];
    let reference = &shortened["body_refs"]["output_preview"];
    assert_eq!(reference["bytes"], original.len());
    let text = shortened["output_preview"].as_str().unwrap();
    assert!(text.len() < 24 * 1024 && text.contains("\n…\n"));
    assert_eq!(
        text.matches('\n').count() as i64 + reference["extra_lines"].as_i64().unwrap(),
        original.matches('\n').count() as i64,
        "the line count adds up"
    );
    let blob: Value = server
        .post("/api/get_blob_text")
        .add_header("authorization", format!("Bearer {TOKEN}"))
        .json(&json!({ "id": reference["id"] }))
        .await
        .json();
    assert_eq!(blob["text"].as_str(), Some(original), "the full text");

    // With the remote first-window budget the bodies count shortened, so
    // the window keeps its rounds instead of one or two whole logs.
    let budgeted: Value = fetch(
        json!({ "toolBodies": true, "windowMaxBytes": 512 * 1024, "windowMaxUserTurns": 8 }),
        false,
    )
    .await
    .json();
    let rounds = budgeted["turns"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["role"] == "user" && t["blocks"][0]["type"] == "text")
        .count();
    assert_eq!(rounds, 8, "the first window keeps its 8 rounds");
    let budgeted_gzip = fetch(
        json!({ "toolBodies": true, "windowMaxBytes": 512 * 1024, "windowMaxUserTurns": 8 }),
        true,
    )
    .await;
    check(&[
        Measured {
            name: "open (12 x 200 KB logs): gzip bytes on the wire",
            value: plain.as_bytes().len() as u64,
            budget: 430_000,
        },
        Measured {
            name: "open (12 x 200 KB logs) with toolBodies: gzip bytes",
            value: short_gzip.as_bytes().len() as u64,
            budget: LONG_OUTPUT_GZIP_BUDGET,
        },
        Measured {
            name: "open (12 x 200 KB logs), toolBodies + 8 rounds: gzip bytes",
            value: budgeted_gzip.as_bytes().len() as u64,
            budget: LONG_OUTPUT_GZIP_BUDGET,
        },
    ]);
}

/// 12 rounds of 200 KB logs with long tool bodies shortened: 391 KB → 9.7 KB
/// gzipped (measured + 10%).
const LONG_OUTPUT_GZIP_BUDGET: u64 = 10_700;

/// With images as references the 120-turn window is 7.5 KB gzipped and its
/// longest string 4 KB (measured + 10%).
const REFS_GZIP_BUDGET: u64 = 8_300;
/// The same window cut to the 8-round budget a remote client asks for.
const BUDGETED_GZIP_BUDGET: u64 = 2_900;
const REFS_LONGEST_BUDGET: u64 = 4_400;

/// The first image reference's id in a response.
fn find_blob_id(v: &Value) -> Option<String> {
    match v {
        Value::Object(map) => {
            if let Some(id) = map.get("blob").and_then(|b| b["id"].as_str()) {
                return Some(id.to_string());
            }
            map.values().find_map(find_blob_id)
        }
        Value::Array(items) => items.iter().find_map(find_blob_id),
        _ => None,
    }
}

fn longest_string(v: &Value) -> usize {
    match v {
        Value::String(s) => s.len(),
        Value::Array(a) => a.iter().map(longest_string).max().unwrap_or(0),
        Value::Object(o) => o.values().map(longest_string).max().unwrap_or(0),
        _ => 0,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// The flags the conversation UI reads at open (fork, 2.7): the goal controls
// and the feedback bar used to read them off a full HTTP snapshot.
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn session_flags_instead_of_the_snapshot() {
    let (server, state, _d, _s) = build_server().await;
    new_connection(&state, "flags").await;
    emit_all(&state, "flags", live_turn_with_tools()).await;

    let post = |cmd: &'static str, conn: &'static str| {
        server
            .post(&format!("/api/{cmd}"))
            .add_header("authorization", format!("Bearer {TOKEN}"))
            .json(&json!({ "connectionId": conn }))
    };
    let snapshot = post("acp_get_session_snapshot", "flags").await;
    assert_eq!(snapshot.status_code(), 200);
    let flags = post("acp_get_session_flags", "flags").await;
    assert_eq!(flags.status_code(), 200, "{}", flags.text());
    let body: Value = flags.json();
    let snap: Value = snapshot.json();
    for field in [
        "goal_actions",
        "feedback_tool_available",
        "native_steering_available",
        "feedback",
    ] {
        assert_eq!(body[field], snap[field], "{field} as on the snapshot");
    }
    let gone: Value = post("acp_get_session_flags", "no-such-connection")
        .await
        .json();
    assert!(gone.is_null());

    println!(
        "open flags: snapshot {} bytes -> flags {} bytes",
        snapshot.as_bytes().len(),
        flags.as_bytes().len()
    );
    check(&[Measured {
        name: "open: session flags bytes (was a full snapshot)",
        value: flags.as_bytes().len() as u64,
        budget: 200,
    }]);
}
