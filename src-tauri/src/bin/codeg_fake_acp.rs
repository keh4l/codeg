//! `codeg-fake-acp`: a scripted ACP agent for tests and performance runs.
//!
//! It speaks the Agent Client Protocol (newline-delimited JSON-RPC 2.0 over
//! stdin/stdout) well enough for codeg to connect, prompt, cancel, switch
//! modes and answer permission requests, and it streams deterministic output:
//! the same scenario always produces the same text, tool calls and bytes, so
//! wire-size budgets and end-to-end timings can be compared run to run.
//!
//! Built only with the `fake-agent-bin` feature (on in `test-utils`), so it
//! never ships in a bundle. Register it as a custom agent with a `binary`
//! distribution whose `cmd` is `codeg-fake-acp`: with nothing in the binary
//! cache codeg launches the copy it finds on PATH.
//!
//! Choosing a scenario: a prompt whose first line is `@scenario <name>` runs
//! that scenario; otherwise `FAKE_ACP_DEFAULT_SCENARIO`, otherwise `echo`.
//!
//! Environment:
//! - `FAKE_ACP_TIME_SCALE`: multiplies every pause (default 1; 0 = no pauses).
//! - `FAKE_ACP_DEFAULT_SCENARIO`: scenario for prompts without a directive.
//! - `FAKE_ACP_STREAM_SECS`: length of `stream-steady` (default 20).
//! - `FAKE_ACP_LOG`: append one JSON line per emitted chunk
//!   (`{"t_ms","sid","kind","offset","len"}`), for emit-to-render latency.

use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde_json::{json, Value};

const VERSION: &str = "0.1.0";

/// Scenarios a prompt can ask for; listed in `--help` and in `echo` replies.
const SCENARIOS: &[&str] = &[
    "echo",
    "stream-steady",
    "big-tool",
    "image",
    "permission",
    "plan",
    "long-idle",
    "burst",
    "budget-turn",
];

struct Agent {
    out: Mutex<std::io::Stdout>,
    next_request_id: AtomicU64,
    pending: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    cancelled: Mutex<HashSet<String>>,
    modes: Mutex<HashMap<String, String>>,
    client_terminal: AtomicBool,
    time_scale: f64,
    log: Option<Mutex<File>>,
    started: Instant,
}

impl Agent {
    fn send(&self, message: &Value) {
        let line = serde_json::to_string(message).expect("serializable message");
        let mut out = self.out.lock().unwrap_or_else(|e| e.into_inner());
        // A closed stdout means codeg is gone; nothing useful to do but stop.
        if writeln!(out, "{line}").and_then(|_| out.flush()).is_err() {
            std::process::exit(0);
        }
    }

    fn respond(&self, id: &Value, result: Value) {
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    }

    fn respond_error(&self, id: &Value, code: i64, message: &str) {
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        }));
    }

    fn notify(&self, method: &str, params: Value) {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }));
    }

    fn update(&self, session_id: &str, update: Value) {
        self.notify(
            "session/update",
            json!({ "sessionId": session_id, "update": update }),
        );
    }

    /// Agent-to-client request; blocks until codeg answers (or 10 minutes).
    fn request(&self, method: &str, params: Value) -> Option<Value> {
        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        rx.recv_timeout(Duration::from_secs(600)).ok()
    }

    fn sleep_ms(&self, ms: u64) {
        let scaled = (ms as f64 * self.time_scale).round();
        if scaled >= 1.0 {
            thread::sleep(Duration::from_millis(scaled as u64));
        }
    }

    fn is_cancelled(&self, session_id: &str) -> bool {
        self.cancelled
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(session_id)
    }

    fn log_chunk(&self, session_id: &str, kind: &str, offset: usize, len: usize) {
        if let Some(log) = &self.log {
            let line = json!({
                "t_ms": unix_ms(),
                "since_start_ms": self.started.elapsed().as_millis() as u64,
                "sid": session_id,
                "kind": kind,
                "offset": offset,
                "len": len,
            });
            let mut file = log.lock().unwrap_or_else(|e| e.into_inner());
            let _ = writeln!(file, "{line}");
        }
    }
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Small deterministic generator (xorshift64*), seeded per scenario.
struct Rng(u64);

impl Rng {
    fn new(seed: &str) -> Self {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in seed.bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        Rng(h | 1)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + (self.next() % (hi - lo + 1) as u64) as usize
    }
}

const WORDS: &[&str] = &[
    "登录",
    "表单",
    "校验",
    "逻辑",
    "后端",
    "接口",
    "返回",
    "错误",
    "提示",
    "字段",
    "密码",
    "邮箱",
    "格式",
    "测试",
    "组件",
    "状态",
    "缓存",
    "请求",
    "响应",
    "配置",
    "the",
    "request",
    "handler",
    "returns",
    "schema",
    "field",
    "cache",
    "state",
    "`loginSchema`",
    "`useForm`",
    "`fetch`",
    "`zod`",
];

/// Markdown prose of roughly `chars` characters: paragraphs, a heading, a
/// list and a code block, so the renderer does real work.
fn prose(rng: &mut Rng, chars: usize) -> String {
    let mut out = String::new();
    let mut block = 0usize;
    while out.chars().count() < chars {
        match block % 6 {
            1 => out.push_str(&format!("### 第 {} 部分\n\n", block / 6 + 1)),
            3 => {
                for _ in 0..3 {
                    out.push_str("- ");
                    out.push_str(&sentence(rng, 18));
                    out.push('\n');
                }
                out.push('\n');
            }
            5 => {
                out.push_str("```ts\nexport const loginSchema = z.object({\n  email: z.string().email(),\n  password: z.string().min(8),\n})\n```\n\n");
            }
            _ => {
                out.push_str(&sentence(rng, 60));
                out.push_str("\n\n");
            }
        }
        block += 1;
    }
    out
}

fn sentence(rng: &mut Rng, words: usize) -> String {
    let n = rng.range(words / 2, words);
    let mut s = String::new();
    for i in 0..n {
        let w = WORDS[rng.range(0, WORDS.len() - 1)];
        if i > 0 && w.is_ascii() {
            s.push(' ');
        }
        s.push_str(w);
    }
    s.push('。');
    s
}

/// Bytes of incompressible "image" data with a PNG signature.
fn fake_png_base64(rng: &mut Rng, bytes: usize) -> String {
    let mut data = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    while data.len() < bytes {
        data.extend_from_slice(&rng.next().to_le_bytes());
    }
    data.truncate(bytes);
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// Text output for tool calls: `lines` numbered lines.
fn tool_lines(rng: &mut Rng, lines: usize) -> String {
    let mut s = String::new();
    for i in 0..lines {
        s.push_str(&format!("{:>5}  {}\n", i + 1, sentence(rng, 10)));
    }
    s
}

struct Turn<'a> {
    agent: &'a Agent,
    session_id: String,
    text_offset: usize,
    thought_offset: usize,
    tool_seq: usize,
}

/// Why a scenario stopped early.
struct Cancelled;

impl<'a> Turn<'a> {
    fn check(&self) -> Result<(), Cancelled> {
        if self.agent.is_cancelled(&self.session_id) {
            Err(Cancelled)
        } else {
            Ok(())
        }
    }

    /// Stream `text` in 6–24 character chunks, `every_ms` apart.
    fn stream(
        &mut self,
        rng: &mut Rng,
        kind: &str,
        text: &str,
        every_ms: u64,
    ) -> Result<(), Cancelled> {
        let chars: Vec<char> = text.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            self.check()?;
            let n = rng.range(6, 24).min(chars.len() - i);
            let chunk: String = chars[i..i + n].iter().collect();
            self.chunk(kind, &chunk);
            i += n;
            self.agent.sleep_ms(every_ms);
        }
        Ok(())
    }

    fn chunk(&mut self, kind: &str, text: &str) {
        let (update_kind, offset) = if kind == "thought" {
            let o = self.thought_offset;
            self.thought_offset += text.chars().count();
            ("agent_thought_chunk", o)
        } else {
            let o = self.text_offset;
            self.text_offset += text.chars().count();
            ("agent_message_chunk", o)
        };
        self.agent.update(
            &self.session_id,
            json!({ "sessionUpdate": update_kind, "content": { "type": "text", "text": text } }),
        );
        self.agent
            .log_chunk(&self.session_id, kind, offset, text.chars().count());
    }

    fn tool_start(&mut self, title: &str, kind: &str, raw_input: Value) -> String {
        self.tool_seq += 1;
        let id = format!("fake-tool-{}", self.tool_seq);
        self.agent.update(
            &self.session_id,
            json!({
                "sessionUpdate": "tool_call",
                "toolCallId": id,
                "title": title,
                "kind": kind,
                "status": "in_progress",
                "rawInput": raw_input,
            }),
        );
        id
    }

    fn tool_done(&self, id: &str, content: Value, raw_output: Value, status: &str) {
        self.agent.update(
            &self.session_id,
            json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": id,
                "status": status,
                "content": content,
                "rawOutput": raw_output,
            }),
        );
    }

    fn text_tool(&mut self, rng: &mut Rng, title: &str, kind: &str, input: Value, lines: usize) {
        let id = self.tool_start(title, kind, input);
        self.agent.sleep_ms(150);
        let output = tool_lines(rng, lines);
        self.tool_done(
            &id,
            json!([{ "type": "content", "content": { "type": "text", "text": output } }]),
            json!({ "output": output }),
            "completed",
        );
    }

    fn usage(&self, used: u64) {
        self.agent.update(
            &self.session_id,
            json!({ "sessionUpdate": "usage_update", "used": used, "size": 200_000 }),
        );
    }

    fn plan(&self, done: usize) {
        let entries: Vec<Value> = ["读代码", "改 schema", "补测试"]
            .iter()
            .enumerate()
            .map(|(i, c)| {
                json!({
                    "content": c,
                    "priority": "medium",
                    "status": if i < done { "completed" } else if i == done { "in_progress" } else { "pending" },
                })
            })
            .collect();
        self.agent.update(
            &self.session_id,
            json!({ "sessionUpdate": "plan", "entries": entries }),
        );
    }
}

fn run_scenario(turn: &mut Turn, name: &str, prompt: &str) -> Result<(), Cancelled> {
    let mut rng = Rng::new(name);
    match name {
        "stream-steady" => {
            let secs: usize = std::env::var("FAKE_ACP_STREAM_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20);
            // ~15 characters every 60 ms ≈ 250 characters a second.
            let thought = prose(&mut rng, 375);
            turn.stream(&mut rng, "thought", &thought, 60)?;
            let text = prose(&mut rng, secs * 250);
            turn.stream(&mut rng, "text", &text, 60)?;
            turn.usage(12_000);
        }
        "big-tool" => {
            turn.stream(&mut rng, "text", "先跑一下测试看看输出。\n\n", 40)?;
            big_tool(turn, &mut rng)?;
            turn.stream(
                &mut rng,
                "text",
                "测试输出很长，关键是最后几行：全部通过。",
                40,
            )?;
        }
        "image" => {
            turn.stream(&mut rng, "text", "截个图看看页面。\n\n", 40)?;
            let id = turn.tool_start(
                "Read screenshot.png",
                "read",
                json!({ "file_path": "screenshot.png" }),
            );
            turn.agent.sleep_ms(200);
            let data = fake_png_base64(&mut rng, 200 * 1024);
            turn.tool_done(
                &id,
                json!([{ "type": "content", "content": { "type": "image", "mimeType": "image/png", "data": data } }]),
                Value::Null,
                "completed",
            );
            turn.stream(&mut rng, "text", "页面布局正常。", 40)?;
        }
        "permission" => {
            turn.stream(&mut rng, "text", "需要运行一个命令。\n\n", 40)?;
            let id = turn.tool_start(
                "rm -rf build",
                "execute",
                json!({ "command": "rm -rf build" }),
            );
            let answer = turn.agent.request(
                "session/request_permission",
                json!({
                    "sessionId": turn.session_id,
                    "toolCall": { "toolCallId": id, "title": "rm -rf build", "kind": "execute", "status": "pending" },
                    "options": [
                        { "optionId": "allow", "name": "Allow", "kind": "allow_once" },
                        { "optionId": "reject", "name": "Reject", "kind": "reject_once" },
                    ],
                }),
            );
            turn.check()?;
            let allowed = answer
                .as_ref()
                .and_then(|a| a.pointer("/outcome/optionId"))
                .and_then(Value::as_str)
                == Some("allow");
            if allowed {
                turn.tool_done(&id, json!([]), json!({ "output": "" }), "completed");
                turn.stream(&mut rng, "text", "已删除 build 目录。", 40)?;
            } else {
                turn.tool_done(&id, json!([]), json!({ "output": "rejected" }), "failed");
                turn.stream(&mut rng, "text", "好的，不删了。", 40)?;
            }
        }
        "plan" => {
            for done in 0..=3 {
                turn.check()?;
                turn.plan(done);
                turn.agent.sleep_ms(300);
            }
            turn.stream(&mut rng, "text", "计划都完成了。", 40)?;
        }
        "long-idle" => {
            // Ten small chunks a second for five minutes: a soak for liveness.
            let text = prose(&mut rng, 3000 * 15);
            turn.stream(&mut rng, "text", &text, 100)?;
        }
        "burst" => {
            let text = prose(&mut rng, 5000 * 15);
            turn.stream(&mut rng, "text", &text, 0)?;
        }
        "budget-turn" => {
            // The fixed turn the wire-budget tests measure. Keep it stable:
            // changing it moves every budget.
            turn.plan(0);
            let thought = prose(&mut rng, 600);
            turn.stream(&mut rng, "thought", &thought, 20)?;
            turn.text_tool(
                &mut rng,
                "Read src/auth/schema.ts",
                "read",
                json!({ "file_path": "src/auth/schema.ts" }),
                200,
            );
            turn.plan(1);
            let text = prose(&mut rng, 1500);
            turn.stream(&mut rng, "text", &text, 20)?;
            turn.text_tool(
                &mut rng,
                "pnpm test src/auth",
                "execute",
                json!({ "command": "pnpm test src/auth" }),
                80,
            );
            turn.plan(3);
            let text = prose(&mut rng, 1500);
            turn.stream(&mut rng, "text", &text, 20)?;
            turn.usage(18_000);
        }
        _ => {
            let reply = format!(
                "echo: {}\n\n(scenarios: {})",
                prompt.trim(),
                SCENARIOS.join(", ")
            );
            turn.chunk("text", &reply);
        }
    }
    Ok(())
}

/// A long-running command whose output streams. Through a client terminal
/// when codeg offers one (how real agents run shell commands, and the path
/// codeg's terminal polling streams), else as one big completed result.
fn big_tool(turn: &mut Turn, rng: &mut Rng) -> Result<(), Cancelled> {
    // ~256 KB over ~5 s: 2000 lines of ~128 bytes, 100 lines every 250 ms.
    let command = "for i in $(seq 1 20); do for j in $(seq 1 100); do printf '%05d %0120d\\n' $((i*100+j)) 0; done; sleep 0.25; done";
    let id = turn.tool_start("pnpm test", "execute", json!({ "command": "pnpm test" }));
    if turn.agent.client_terminal.load(Ordering::SeqCst) {
        let created = turn.agent.request(
            "terminal/create",
            json!({
                "sessionId": turn.session_id,
                "command": "sh",
                "args": ["-c", command],
                "outputByteLimit": 1_048_576,
            }),
        );
        if let Some(terminal_id) = created
            .as_ref()
            .and_then(|r| r.get("terminalId"))
            .and_then(Value::as_str)
        {
            let terminal_id = terminal_id.to_string();
            turn.agent.update(
                &turn.session_id,
                json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": id,
                    "content": [{ "type": "terminal", "terminalId": terminal_id }],
                }),
            );
            let exit = turn.agent.request(
                "terminal/wait_for_exit",
                json!({ "sessionId": turn.session_id, "terminalId": terminal_id }),
            );
            let output = turn.agent.request(
                "terminal/output",
                json!({ "sessionId": turn.session_id, "terminalId": terminal_id }),
            );
            turn.agent.request(
                "terminal/release",
                json!({ "sessionId": turn.session_id, "terminalId": terminal_id }),
            );
            let text = output
                .as_ref()
                .and_then(|o| o.get("output"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let failed = exit
                .as_ref()
                .and_then(|e| e.get("exitCode"))
                .and_then(Value::as_i64)
                .is_some_and(|c| c != 0);
            turn.tool_done(
                &id,
                json!([{ "type": "terminal", "terminalId": terminal_id }]),
                json!({ "output": text }),
                if failed { "failed" } else { "completed" },
            );
            return turn.check();
        }
    }
    for _ in 0..20 {
        turn.check()?;
        turn.agent.sleep_ms(250);
    }
    let output = tool_lines(rng, 2000);
    turn.tool_done(
        &id,
        json!([{ "type": "content", "content": { "type": "text", "text": output } }]),
        json!({ "output": output }),
        "completed",
    );
    Ok(())
}

fn prompt_text(params: &Value) -> String {
    params
        .get("prompt")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// `@scenario <name>` on the first line picks the scenario.
fn scenario_for(prompt: &str) -> String {
    let first = prompt.lines().next().unwrap_or("").trim();
    if let Some(name) = first.strip_prefix("@scenario") {
        let name = name.trim();
        if !name.is_empty() {
            return name.to_string();
        }
    }
    std::env::var("FAKE_ACP_DEFAULT_SCENARIO").unwrap_or_else(|_| "echo".to_string())
}

fn modes_state(current: &str) -> Value {
    json!({
        "currentModeId": current,
        "availableModes": [
            { "id": "default", "name": "Default", "description": "Ask before risky actions" },
            { "id": "plan", "name": "Plan", "description": "Plan only, no edits" },
        ],
    })
}

fn config_options(model: &str) -> Value {
    json!([{
        "id": "model",
        "name": "Model",
        "category": "model",
        "type": "select",
        "currentValue": model,
        "options": [
            { "value": "fake-fast", "name": "Fake Fast" },
            { "value": "fake-smart", "name": "Fake Smart" },
        ],
    }])
}

fn new_session_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("fake-{:x}-{:x}", std::process::id(), nanos)
}

fn handle_request(agent: &Arc<Agent>, id: Value, method: &str, params: Value) {
    match method {
        "initialize" => {
            let terminal = params
                .pointer("/clientCapabilities/terminal")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            agent.client_terminal.store(terminal, Ordering::SeqCst);
            agent.respond(
                &id,
                json!({
                    "protocolVersion": 1,
                    "agentCapabilities": {
                        "loadSession": true,
                        "promptCapabilities": { "image": true, "audio": false, "embeddedContext": true },
                    },
                    "authMethods": [],
                    "agentInfo": { "name": "codeg-fake-acp", "version": VERSION },
                }),
            );
        }
        "authenticate" => agent.respond(&id, json!({})),
        "session/new" => {
            let session_id = new_session_id();
            agent
                .modes
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(session_id.clone(), "default".to_string());
            agent.respond(
                &id,
                json!({
                    "sessionId": session_id,
                    "modes": modes_state("default"),
                    "configOptions": config_options("fake-fast"),
                }),
            );
        }
        "session/load" | "session/resume" => {
            let session_id = params
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let mode = agent
                .modes
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entry(session_id)
                .or_insert_with(|| "default".to_string())
                .clone();
            agent.respond(
                &id,
                json!({ "modes": modes_state(&mode), "configOptions": config_options("fake-fast") }),
            );
        }
        "session/set_mode" => {
            let session_id = params
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let mode = params
                .get("modeId")
                .and_then(Value::as_str)
                .unwrap_or("default")
                .to_string();
            agent
                .modes
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(session_id.clone(), mode.clone());
            agent.respond(&id, json!({}));
            agent.update(
                &session_id,
                json!({ "sessionUpdate": "current_mode_update", "currentModeId": mode }),
            );
        }
        "session/set_config_option" => {
            let value = params
                .get("value")
                .and_then(Value::as_str)
                .unwrap_or("fake-fast");
            agent.respond(&id, json!({ "configOptions": config_options(value) }));
        }
        "session/prompt" => {
            let agent = Arc::clone(agent);
            thread::spawn(move || {
                let session_id = params
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                agent
                    .cancelled
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&session_id);
                let prompt = prompt_text(&params);
                let scenario = scenario_for(&prompt);
                let mut turn = Turn {
                    agent: &agent,
                    session_id: session_id.clone(),
                    text_offset: 0,
                    thought_offset: 0,
                    tool_seq: 0,
                };
                let stop = match run_scenario(&mut turn, &scenario, &prompt) {
                    Ok(()) => "end_turn",
                    Err(Cancelled) => "cancelled",
                };
                agent.respond(&id, json!({ "stopReason": stop }));
            });
        }
        _ => agent.respond_error(&id, -32601, &format!("method not found: {method}")),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("codeg-fake-acp {VERSION}");
        return;
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!(
            "codeg-fake-acp {VERSION}: scripted ACP agent for tests.\nScenarios: {}",
            SCENARIOS.join(", ")
        );
        return;
    }

    let time_scale = std::env::var("FAKE_ACP_TIME_SCALE")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| *v >= 0.0)
        .unwrap_or(1.0);
    let log = std::env::var("FAKE_ACP_LOG").ok().and_then(|path| {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()
            .map(Mutex::new)
    });
    let agent = Arc::new(Agent {
        out: Mutex::new(std::io::stdout()),
        next_request_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
        cancelled: Mutex::new(HashSet::new()),
        modes: Mutex::new(HashMap::new()),
        client_terminal: AtomicBool::new(false),
        time_scale,
        log,
        started: Instant::now(),
    });

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let method = message.get("method").and_then(Value::as_str);
        let id = message.get("id").cloned();
        match (method, id) {
            (Some(method), Some(id)) => {
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                handle_request(&agent, id, method, params);
            }
            (Some("session/cancel"), None) => {
                if let Some(session_id) =
                    message.pointer("/params/sessionId").and_then(Value::as_str)
                {
                    agent
                        .cancelled
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(session_id.to_string());
                }
            }
            (Some(_), None) => {}
            (None, Some(id)) => {
                // A response to one of our requests.
                let Some(id) = id.as_u64() else { continue };
                let waiter = agent
                    .pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                if let Some(waiter) = waiter {
                    let _ = waiter.send(message.get("result").cloned().unwrap_or(Value::Null));
                }
            }
            (None, None) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1 as acp;

    #[test]
    fn scenario_directive_on_first_line() {
        assert_eq!(scenario_for("@scenario burst\nhello"), "burst");
        assert_eq!(scenario_for("@scenario   big-tool"), "big-tool");
    }

    #[test]
    fn generated_output_is_deterministic() {
        let a = prose(&mut Rng::new("x"), 500);
        let b = prose(&mut Rng::new("x"), 500);
        assert_eq!(a, b);
        assert!(a.chars().count() >= 500);
        assert_ne!(a, prose(&mut Rng::new("y"), 500));
    }

    #[test]
    fn messages_parse_as_acp_types() {
        let session: acp::NewSessionResponse = serde_json::from_value(json!({
            "sessionId": "s",
            "modes": modes_state("default"),
            "configOptions": config_options("fake-fast"),
        }))
        .expect("session/new response");
        assert!(session.modes.is_some());
        assert_eq!(session.config_options.map(|o| o.len()), Some(1));

        for update in [
            json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "hi" } }),
            json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": "hm" } }),
            json!({ "sessionUpdate": "tool_call", "toolCallId": "t", "title": "x", "kind": "execute", "status": "in_progress", "rawInput": {} }),
            json!({ "sessionUpdate": "tool_call_update", "toolCallId": "t", "status": "completed",
                    "content": [{ "type": "content", "content": { "type": "image", "mimeType": "image/png", "data": "AA==" } }] }),
            json!({ "sessionUpdate": "plan", "entries": [{ "content": "a", "priority": "medium", "status": "pending" }] }),
            json!({ "sessionUpdate": "usage_update", "used": 1, "size": 2 }),
            json!({ "sessionUpdate": "current_mode_update", "currentModeId": "plan" }),
        ] {
            let parsed: Result<acp::SessionNotification, _> =
                serde_json::from_value(json!({ "sessionId": "s", "update": update.clone() }));
            assert!(parsed.is_ok(), "{update}: {:?}", parsed.err());
        }

        let permission: Result<acp::RequestPermissionRequest, _> = serde_json::from_value(json!({
            "sessionId": "s",
            "toolCall": { "toolCallId": "t", "title": "x", "kind": "execute", "status": "pending" },
            "options": [{ "optionId": "allow", "name": "Allow", "kind": "allow_once" }],
        }));
        assert!(permission.is_ok(), "{:?}", permission.err());

        let prompt: Result<acp::PromptResponse, _> =
            serde_json::from_value(json!({ "stopReason": "cancelled" }));
        assert!(prompt.is_ok());
    }
}
