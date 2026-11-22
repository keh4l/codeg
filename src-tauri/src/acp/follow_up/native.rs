//! keh4l build: native mid-turn steering beyond `_session/steering`.
//!
//! Upstream steers claude-agent-acp ≥ 0.65.0 and codex-acp ≥ 2.4.0 with the
//! `_session/steering` extension (`connection.rs::send_steer_request`). These
//! agents have a native way of their own, ported from T3 Code:
//!
//! - **Grok** — `_x.ai/interject {sessionId, text, content?}`. The running tool
//!   finishes; the model reads the message at its next step. Acceptance is the
//!   delivery. Images ride along as `content`.
//! - **Kiro** — `_session/steer {sessionId, message}` → `{queued: true,
//!   messageId}`. Text only. Once the model reads it Kiro reports
//!   `session_info_update._meta.kiro.kind = "steering_injected"`, and the reply
//!   then ends with a `[STEERING steer-…: …]` note meant for Kiro's own UI,
//!   which [`KiroSteerNoteFilter`] drops from the stream.
//! - **Antigravity ≥ 1.5.0** — another `session/prompt` while one runs: the
//!   agent answers the running prompt `end_turn` and carries the turn on under
//!   the new one, tools and sub-agents untouched. The conversation loop swaps
//!   its in-flight prompt for the new one (see the `Steer` arm).
//!
//! A connection's wire is pinned at `initialize` ([`register`]); the loop asks
//! [`wire`] on every steer. No entry = upstream's `_session/steering`.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use agent_client_protocol::schema::v1::{ContentBlock, Implementation, SessionId, SessionUpdate};
use agent_client_protocol::{Agent, ConnectionTo, UntypedMessage};

use crate::acp::connection::SteerOutcome;
use crate::acp::error::AcpError;
use crate::acp::types::PromptInputBlock;
use crate::models::agent::AgentType;

/// How a connection steers when it has no `_session/steering`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SteerWire {
    GrokInterject,
    KiroSteer,
    /// Antigravity: a second `session/prompt` mid-turn.
    PromptSteer,
}

impl SteerWire {
    /// Whether the wire carries images and files, or text only.
    pub fn accepts_attachments(self) -> bool {
        !matches!(self, SteerWire::KiroSteer)
    }
}

const GROK_INTERJECT_METHOD: &str = "_x.ai/interject";
const KIRO_STEER_METHOD: &str = "_session/steer";
/// What Kiro answers on `initialize` (`agentInfo.name`), checked against 2.24.1.
const KIRO_AGENT_NAME: &str = "Kiro CLI Agent";
/// First Antigravity ACP server that steers with a mid-turn prompt.
const ANTIGRAVITY_PROMPT_STEER_SINCE: (u64, u64, u64) = (1, 5, 0);

fn wires() -> &'static Mutex<HashMap<String, SteerWire>> {
    static WIRES: OnceLock<Mutex<HashMap<String, SteerWire>>> = OnceLock::new();
    WIRES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The wire an agent steers with, from what it said at `initialize`.
pub fn wire_for(
    agent_type: AgentType,
    agent_info: Option<&Implementation>,
    speaks_antigravity: bool,
) -> Option<SteerWire> {
    let name = agent_info.map(|i| i.name.as_str());
    match agent_type {
        AgentType::Grok => Some(SteerWire::GrokInterject),
        AgentType::Kiro => Some(SteerWire::KiroSteer),
        AgentType::Custom(_) if name == Some(KIRO_AGENT_NAME) => Some(SteerWire::KiroSteer),
        _ if speaks_antigravity
            && agent_info
                .and_then(|i| leading_version(&i.version))
                .is_some_and(|v| v >= ANTIGRAVITY_PROMPT_STEER_SINCE) =>
        {
            Some(SteerWire::PromptSteer)
        }
        _ => None,
    }
}

/// `major.minor.patch` at the start of a version string (Antigravity reports
/// plain versions; anything unparsable fails closed).
fn leading_version(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.trim().splitn(3, '.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let rest = parts.next()?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    let patch = digits.parse().ok()?;
    Some((major, minor, patch))
}

/// Pin a connection's wire at `initialize`. Returns whether it has one, which
/// the caller ORs into `native_steering_available`.
pub fn register(
    conn_id: &str,
    agent_type: AgentType,
    agent_info: Option<&Implementation>,
    speaks_antigravity: bool,
) -> bool {
    let wire = wire_for(agent_type, agent_info, speaks_antigravity);
    let mut map = wires().lock().unwrap_or_else(|e| e.into_inner());
    match wire {
        Some(w) => {
            map.insert(conn_id.to_string(), w);
            true
        }
        None => {
            map.remove(conn_id);
            false
        }
    }
}

pub fn wire(conn_id: &str) -> Option<SteerWire> {
    wires()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(conn_id)
        .copied()
}

/// Drop a connection's wire (it went away, or its wire turned out not to work).
pub fn forget(conn_id: &str) {
    wires()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(conn_id);
}

/// Whether a steer with these blocks can go natively on this connection.
/// Upstream's `_session/steering` carries everything.
pub fn accepts(conn_id: &str, blocks: &[PromptInputBlock]) -> bool {
    match wire(conn_id) {
        Some(w) if !w.accepts_attachments() => blocks
            .iter()
            .all(|b| matches!(b, PromptInputBlock::Text { .. })),
        _ => true,
    }
}

/// The plain text of a steer: text blocks, then a line per linked or embedded
/// resource so a text-only wire still names the file.
pub fn steer_text(blocks: &[PromptInputBlock]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for block in blocks {
        match block {
            PromptInputBlock::Text { text } => parts.push(text.clone()),
            PromptInputBlock::ResourceLink { uri, .. } | PromptInputBlock::Resource { uri, .. } => {
                parts.push(uri.clone())
            }
            PromptInputBlock::Image { .. } => {}
        }
    }
    parts.join("\n\n")
}

pub(crate) fn grok_interject_params(
    session_id: &str,
    blocks: &[PromptInputBlock],
) -> serde_json::Value {
    let images: Vec<serde_json::Value> = crate::acp::connection::map_prompt_blocks(blocks.to_vec())
        .into_iter()
        .filter(|b| matches!(b, ContentBlock::Image(_)))
        .filter_map(|b| serde_json::to_value(b).ok())
        .collect();
    let mut params = serde_json::json!({
        "sessionId": session_id,
        "text": steer_text(blocks),
    });
    if !images.is_empty() {
        params["content"] = serde_json::Value::Array(images);
    }
    params
}

pub(crate) fn kiro_steer_params(
    session_id: &str,
    blocks: &[PromptInputBlock],
) -> serde_json::Value {
    serde_json::json!({ "sessionId": session_id, "message": steer_text(blocks) })
}

/// Grok answers `{status: "queued"}` (T3 reads it under `result`; both shapes
/// are accepted).
pub(crate) fn grok_accepted(raw: &serde_json::Value) -> bool {
    let status = |v: &serde_json::Value| {
        v.get("status").and_then(serde_json::Value::as_str) == Some("queued")
    };
    status(raw) || raw.get("result").is_some_and(status)
}

pub(crate) fn kiro_accepted(raw: &serde_json::Value) -> bool {
    raw.get("queued").and_then(serde_json::Value::as_bool) == Some(true)
}

/// Send a steer over a request wire (Grok / Kiro). The prompt wire is handled
/// by the loop itself.
pub async fn send(
    cx: &ConnectionTo<Agent>,
    session_id: &SessionId,
    blocks: &[PromptInputBlock],
    wire: SteerWire,
) -> Result<SteerOutcome, AcpError> {
    let (method, params) = match wire {
        SteerWire::GrokInterject => (
            GROK_INTERJECT_METHOD,
            grok_interject_params(session_id.0.as_ref(), blocks),
        ),
        SteerWire::KiroSteer => (
            KIRO_STEER_METHOD,
            kiro_steer_params(session_id.0.as_ref(), blocks),
        ),
        SteerWire::PromptSteer => {
            return Err(AcpError::protocol(
                "prompt steering is sent by the conversation loop",
            ))
        }
    };
    let request = UntypedMessage::new(method, params)
        .map_err(|e| AcpError::protocol(format!("Failed to build {method}: {e}")))?;
    let raw = cx
        .send_request_to(Agent, request)
        .block_task()
        .await
        .map_err(|e| AcpError::protocol(format!("{method} failed: {e}")))?;
    let accepted = match wire {
        SteerWire::GrokInterject => grok_accepted(&raw),
        _ => kiro_accepted(&raw),
    };
    if accepted {
        Ok(SteerOutcome::Injected)
    } else {
        Err(AcpError::protocol(format!(
            "{method} did not queue the message: {raw}"
        )))
    }
}

// ------------------------------------------------------------ Kiro's note

const KIRO_STEERING_NOTE: &str = "[STEERING steer-";

/// Drops Kiro's `[STEERING steer-…: …]` note from the streamed reply after an
/// injected steer, holding back a chunk end that may be the start of the note
/// until the next chunk shows otherwise (T3's `makeKiroSteeringNoteFilter`).
#[derive(Debug, Default)]
pub struct KiroSteerNoteFilter {
    active: bool,
    held: String,
    in_note: bool,
}

fn kiro_meta_kind(meta: Option<&serde_json::Map<String, serde_json::Value>>) -> Option<&str> {
    meta?.get("kiro")?.get("kind")?.as_str()
}

/// Length of the longest end of `text` that could still grow into the note.
fn note_prefix_len(text: &str) -> usize {
    let max = text.len().min(KIRO_STEERING_NOTE.len() - 1);
    for len in (1..=max).rev() {
        let start = text.len() - len;
        if !text.is_char_boundary(start) {
            continue;
        }
        if KIRO_STEERING_NOTE.starts_with(&text[start..]) {
            return len;
        }
    }
    0
}

impl KiroSteerNoteFilter {
    /// The visible part of one text chunk.
    pub fn filter_text(&mut self, chunk: &str) -> String {
        let mut pending = std::mem::take(&mut self.held) + chunk;
        let mut visible = String::new();
        while !pending.is_empty() {
            if self.in_note {
                match pending.find(']') {
                    Some(end) => {
                        pending = pending[end + 1..].to_string();
                        self.in_note = false;
                        continue;
                    }
                    None => {
                        pending.clear();
                        break;
                    }
                }
            }
            if let Some(start) = pending.find(KIRO_STEERING_NOTE) {
                visible.push_str(pending[..start].trim_end());
                pending = pending[start + KIRO_STEERING_NOTE.len()..].to_string();
                self.in_note = true;
                continue;
            }
            let held = note_prefix_len(&pending);
            let mut cut = pending.len() - held;
            // The space before a note that may be starting goes with it.
            if held > 0 {
                cut = pending[..cut].trim_end().len();
            }
            visible.push_str(&pending[..cut]);
            self.held = pending[cut..].to_string();
            pending.clear();
        }
        visible
    }
}

/// Apply the Kiro note filter to one session update. `None` drops it (a
/// chunk that was all note). Every other agent passes through untouched.
pub fn filter_update(
    agent_type: AgentType,
    mut update: SessionUpdate,
    filter: &mut KiroSteerNoteFilter,
) -> Option<SessionUpdate> {
    if agent_type != AgentType::Kiro {
        return Some(update);
    }
    match &mut update {
        SessionUpdate::SessionInfoUpdate(info) => {
            match kiro_meta_kind(info.meta.as_ref()) {
                Some("steering_injected") => {
                    *filter = KiroSteerNoteFilter {
                        active: true,
                        ..Default::default()
                    };
                }
                Some("steering_cleared") => *filter = KiroSteerNoteFilter::default(),
                _ => {}
            }
            Some(update)
        }
        SessionUpdate::AgentMessageChunk(chunk) if filter.active => {
            if let ContentBlock::Text(text) = &mut chunk.content {
                let visible = filter.filter_text(&text.text);
                if visible.is_empty() {
                    return None;
                }
                text.text = visible;
            }
            Some(update)
        }
        _ => Some(update),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(name: &str, version: &str) -> Implementation {
        Implementation::new(name, version)
    }

    #[test]
    fn wires_by_agent() {
        assert_eq!(
            wire_for(AgentType::Grok, None, false),
            Some(SteerWire::GrokInterject)
        );
        assert_eq!(
            wire_for(AgentType::Kiro, None, false),
            Some(SteerWire::KiroSteer)
        );
        assert_eq!(
            wire_for(
                AgentType::Custom("kiro-x"),
                Some(&info(KIRO_AGENT_NAME, "2.24.1")),
                false
            ),
            Some(SteerWire::KiroSteer)
        );
        assert_eq!(wire_for(AgentType::Gemini, None, false), None);
        assert_eq!(wire_for(AgentType::ClaudeCode, None, false), None);
    }

    #[test]
    fn antigravity_steers_with_a_prompt_from_1_5_0() {
        let at = |v: &str| {
            wire_for(
                AgentType::Antigravity,
                Some(&info("antigravity-acp", v)),
                true,
            )
        };
        assert_eq!(at("1.5.0"), Some(SteerWire::PromptSteer));
        assert_eq!(at("1.6.2-beta"), Some(SteerWire::PromptSteer));
        assert_eq!(at("1.4.1"), None);
        assert_eq!(at("nightly"), None);
        assert_eq!(wire_for(AgentType::Antigravity, None, true), None);
    }

    #[test]
    fn register_and_forget() {
        assert!(register("c-native-1", AgentType::Grok, None, false));
        assert_eq!(wire("c-native-1"), Some(SteerWire::GrokInterject));
        assert!(!register("c-native-1", AgentType::Gemini, None, false));
        assert_eq!(wire("c-native-1"), None);
        assert!(register("c-native-2", AgentType::Kiro, None, false));
        forget("c-native-2");
        assert_eq!(wire("c-native-2"), None);
    }

    #[test]
    fn kiro_takes_text_only() {
        register("c-native-3", AgentType::Kiro, None, false);
        let text = vec![PromptInputBlock::Text { text: "hi".into() }];
        let image = vec![PromptInputBlock::Image {
            data: "AAAA".into(),
            mime_type: "image/png".into(),
            uri: None,
        }];
        assert!(accepts("c-native-3", &text));
        assert!(!accepts("c-native-3", &image));
        assert!(accepts("c-unknown", &image));
        forget("c-native-3");
    }

    #[test]
    fn request_shapes() {
        let blocks = vec![
            PromptInputBlock::Text {
                text: "use env.ts".into(),
            },
            PromptInputBlock::Image {
                data: "AAAA".into(),
                mime_type: "image/png".into(),
                uri: None,
            },
        ];
        let grok = grok_interject_params("s1", &blocks);
        assert_eq!(grok["sessionId"], "s1");
        assert_eq!(grok["text"], "use env.ts");
        assert_eq!(grok["content"][0]["type"], "image");
        let text_only = grok_interject_params("s1", &blocks[..1]);
        assert!(text_only.get("content").is_none());
        let kiro = kiro_steer_params("s2", &blocks[..1]);
        assert_eq!(
            kiro,
            serde_json::json!({"sessionId": "s2", "message": "use env.ts"})
        );
    }

    #[test]
    fn acceptance() {
        assert!(grok_accepted(&serde_json::json!({"status": "queued"})));
        assert!(grok_accepted(
            &serde_json::json!({"result": {"status": "queued"}})
        ));
        assert!(!grok_accepted(&serde_json::json!({"status": "rejected"})));
        assert!(kiro_accepted(
            &serde_json::json!({"queued": true, "messageId": "m"})
        ));
        assert!(!kiro_accepted(&serde_json::json!({})));
    }

    #[test]
    fn kiro_note_is_dropped_across_chunks() {
        let mut f = KiroSteerNoteFilter {
            active: true,
            ..Default::default()
        };
        // The note closes the reply, split anywhere across chunks.
        let mut out = String::new();
        for chunk in ["Done.", " [STEER", "ING steer-12: use env.ts", "]"] {
            out.push_str(&f.filter_text(chunk));
        }
        assert_eq!(out, "Done.");
        // Text after it still shows.
        assert_eq!(f.filter_text("[STEERING steer-13: x] more"), " more");
        let mut f = KiroSteerNoteFilter {
            active: true,
            ..Default::default()
        };
        assert_eq!(f.filter_text("a [x]"), "a [x]");
        // A held prefix that turns out not to be the note comes back, with
        // the space held before it.
        assert_eq!(f.filter_text("value ["), "value");
        assert_eq!(f.filter_text("1, 2]"), " [1, 2]");
    }
}
