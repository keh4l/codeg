//! Shortened tool bodies (fork).
//!
//! A tool call's input or output can be megabytes: a log printed whole, a file
//! written in one call, a test run. Sending each in full to a remote client —
//! in the live snapshot, the conversation detail and the live events — is
//! most of what opening a busy conversation waits for over a slow link, while
//! the UI shows a few screens of it at most. A client that asks gets such a
//! body shortened to its start and end, with the full text in the blob store
//! (`web::blob_store`, text domain) behind a reference it loads when the
//! reader asks for it (`POST /api/get_blob_text`):
//!
//! ```json
//! {"output_preview": "<start>\n…\n<end>",
//!  "body_refs": {"output_preview": {"id": "<32 hex>", "bytes": 912345, "extra_lines": 15210}}}
//! ```
//!
//! * A string over [`Caps::max`] bytes keeps its first `head` and last `tail`
//!   bytes, cut at a line end when one is near, with `…` in between (on a
//!   line of its own when both cuts are at line ends).
//! * A body that is a JSON object or array stays valid JSON: only its string
//!   leaves over the cap are shortened, so the cards that parse a result
//!   still can. One that is big only because it has many small leaves is
//!   left whole.
//! * `bytes` is the full body's UTF-8 length; `extra_lines` how many more
//!   `\n` the full body has than the shortened one, so a line count shown
//!   before the full body is loaded is still right.
//! * The reference sits in a `body_refs` map on the object that holds the
//!   shortened field, keyed by that field's name.
//!
//! Like `image_refs`, this works on the serialized JSON at the response
//! boundary; the models, the parsers and the desktop app see nothing of it.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use super::blob_store::{BlobKind, BlobStore};

/// When a string is shortened, and to what.
#[derive(Debug, Clone, Copy)]
pub struct Caps {
    /// Longest string (UTF-8 bytes) left whole.
    pub max: usize,
    /// Bytes kept from the start of a longer one.
    pub head: usize,
    /// Bytes kept from its end.
    pub tail: usize,
}

/// Every shortened body, unless said otherwise.
pub const STANDARD: Caps = Caps {
    max: 24 * 1024,
    head: 16 * 1024,
    tail: 4 * 1024,
};

/// The older finished calls of a live turn whose tool payload is already
/// over [`LIVE_TOOL_BUDGET`].
pub const SMALL: Caps = Caps {
    max: 2 * 1024,
    head: 1536,
    tail: 512,
};

/// Tool payload of a live snapshot (newest calls first) past which older
/// finished calls get [`SMALL`].
pub const LIVE_TOOL_BUDGET: usize = 384 * 1024;

/// What stands for the part left out.
pub const MARKER: char = '…';

fn floor_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

fn newlines(s: &str) -> usize {
    s.bytes().filter(|b| *b == b'\n').count()
}

/// `text` cut to its start and end, or `None` when it is within `caps.max`.
pub fn shorten_text(text: &str, caps: Caps) -> Option<String> {
    if text.len() <= caps.max {
        return None;
    }
    let head_limit = floor_boundary(text, caps.head);
    let (head_end, head_at_line) = match text[..head_limit].rfind('\n') {
        Some(i) if i + 1 >= caps.head / 2 => (i + 1, true),
        _ => (head_limit, false),
    };
    let tail_limit = ceil_boundary(text, text.len().saturating_sub(caps.tail));
    let (tail_start, tail_at_line) = if text.as_bytes()[tail_limit - 1] == b'\n' {
        (tail_limit, true)
    } else {
        match text[tail_limit..].find('\n') {
            Some(j) if j < caps.tail / 2 && tail_limit + j + 1 < text.len() => {
                (tail_limit + j + 1, true)
            }
            _ => (tail_limit, false),
        }
    };
    let mut out = String::with_capacity(head_end + (text.len() - tail_start) + 8);
    out.push_str(&text[..head_end]);
    if head_at_line && tail_at_line {
        out.push(MARKER);
        out.push('\n');
    } else {
        out.push(' ');
        out.push(MARKER);
        out.push(' ');
    }
    out.push_str(&text[tail_start..]);
    Some(out)
}

/// Shorten every string leaf of `value` over `caps.max`. Returns how many
/// `\n` that removed, or `None` when nothing was shortened.
fn shorten_leaves(value: &mut Value, caps: Caps) -> Option<i64> {
    match value {
        Value::String(s) => {
            let short = shorten_text(s, caps)?;
            let extra = newlines(s) as i64 - newlines(&short) as i64;
            *s = short;
            Some(extra)
        }
        Value::Array(items) => sum(items.iter_mut().map(|v| shorten_leaves(v, caps))),
        Value::Object(map) => sum(map.values_mut().map(|v| shorten_leaves(v, caps))),
        _ => None,
    }
}

fn sum(parts: impl Iterator<Item = Option<i64>>) -> Option<i64> {
    parts.fold(None, |acc, part| match (acc, part) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    })
}

/// A text body shortened: JSON containers leaf by leaf (still valid JSON),
/// anything else as text. With the `\n` it lost.
fn shorten_body(text: &str, caps: Caps) -> Option<(String, i64)> {
    if text.len() <= caps.max {
        return None;
    }
    let trimmed = text.trim_start();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(mut value) = serde_json::from_str::<Value>(text) {
            // Valid JSON is never cut as text: a card would no longer parse it.
            let extra = shorten_leaves(&mut value, caps)?;
            return Some((serde_json::to_string(&value).ok()?, extra));
        }
    }
    let short = shorten_text(text, caps)?;
    let extra = newlines(text) as i64 - newlines(&short) as i64;
    Some((short, extra))
}

/// Store `full` and return its reference.
fn reference(store: &BlobStore, full: &str, extra_lines: i64) -> Option<Value> {
    match store.put(BlobKind::Text, full.as_bytes()) {
        Ok(id) => Some(json!({ "id": id, "bytes": full.len(), "extra_lines": extra_lines })),
        Err(err) => {
            tracing::warn!("[body-caps] keeping a tool body whole: {err}");
            None
        }
    }
}

fn add_ref(map: &mut Map<String, Value>, field: &str, reference: Value) {
    let refs = map
        .entry("body_refs")
        .or_insert_with(|| Value::Object(Map::new()));
    if let Value::Object(refs) = refs {
        refs.insert(field.to_string(), reference);
    }
}

/// Shorten the string at `map[field]` (see [`shorten_body`]) and reference
/// its full text under `body_refs[field]`. Whether it was shortened.
pub fn shorten_string_field(
    map: &mut Map<String, Value>,
    field: &str,
    caps: Caps,
    store: &BlobStore,
) -> bool {
    let Some(Value::String(text)) = map.get(field) else {
        return false;
    };
    let Some((short, extra)) = shorten_body(text, caps) else {
        return false;
    };
    let Some(reference) = reference(store, text, extra) else {
        return false;
    };
    map.insert(field.to_string(), Value::String(short));
    add_ref(map, field, reference);
    true
}

/// Shorten the string leaves of the JSON value at `map[field]` and reference
/// its full serialization (what a client gets from `JSON.stringify` of the
/// original) under `body_refs[ref_name]`.
fn shorten_value_field(
    map: &mut Map<String, Value>,
    field: &str,
    ref_name: &str,
    caps: Caps,
    store: &BlobStore,
) -> bool {
    let Some(value) = map.get_mut(field) else {
        return false;
    };
    if value.is_null() || !has_long_leaf(value, caps.max) {
        return false;
    }
    let Ok(full) = serde_json::to_string(value) else {
        return false;
    };
    let mut short = value.clone();
    let Some(extra) = shorten_leaves(&mut short, caps) else {
        return false;
    };
    let Some(reference) = reference(store, &full, extra) else {
        return false;
    };
    *value = short;
    add_ref(map, ref_name, reference);
    true
}

fn has_long_leaf(value: &Value, max: usize) -> bool {
    match value {
        Value::String(s) => s.len() > max,
        Value::Array(items) => items.iter().any(|v| has_long_leaf(v, max)),
        Value::Object(map) => map.values().any(|v| has_long_leaf(v, max)),
        _ => false,
    }
}

// ─── Loading a full body ────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct GetBlobTextParams {
    pub id: String,
}

/// `POST /api/get_blob_text {id}` → `{"text": …}`: the full text of a
/// shortened tool body. Authenticated like every `/api` call (a tool body
/// can hold anything a command printed). Text blobs only; a blob not (or no
/// longer) stored is `not_found`, and the client keeps the shortened body.
pub async fn get_blob_text(
    axum::Json(params): axum::Json<GetBlobTextParams>,
) -> Result<axum::Json<Value>, crate::app_error::AppCommandError> {
    use crate::app_error::{AppCommandError, AppErrorCode};
    let not_found = || {
        AppCommandError::new(
            AppErrorCode::NotFound,
            "The full text is no longer available",
        )
    };
    let store = super::blob_store::global().ok_or_else(not_found)?;
    let id = params.id;
    let bytes = tokio::task::spawn_blocking(move || store.read(BlobKind::Text, &id))
        .await
        .map_err(|e| AppCommandError::io_error(e.to_string()))?
        .ok_or_else(not_found)?;
    let text = String::from_utf8(bytes).map_err(|_| not_found())?;
    Ok(axum::Json(json!({ "text": text })))
}

// ─── Persisted conversation detail ──────────────────────────────────────────

/// Shorten the tool bodies of a conversation detail (or a page of turns):
/// every `tool_use.input_preview` and `tool_result.output_preview`, wherever
/// they sit (a sub-agent's transcript included). Returns how many.
pub fn project_turn_bodies(value: &mut Value, store: &BlobStore) -> usize {
    let mut shortened = 0;
    visit_blocks(value, store, &mut shortened);
    shortened
}

fn visit_blocks(value: &mut Value, store: &BlobStore, shortened: &mut usize) {
    match value {
        Value::Object(map) => {
            let field = match map.get("type").and_then(Value::as_str) {
                Some("tool_use") => Some("input_preview"),
                Some("tool_result") => Some("output_preview"),
                _ => None,
            };
            if let Some(field) = field {
                if shorten_string_field(map, field, STANDARD, store) {
                    *shortened += 1;
                }
            }
            for (key, child) in map.iter_mut() {
                if key != "body_refs" {
                    visit_blocks(child, store, shortened);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                visit_blocks(item, store, shortened);
            }
        }
        _ => {}
    }
}

// ─── Live events ────────────────────────────────────────────────────────────

/// Whether `slim_event` would change this live event: a tool call carrying
/// images, or a finished one with a body over the cap. Checked on the event
/// itself, so the stream of small events is never serialized twice.
pub fn event_needs_slimming(event: &crate::acp::types::AcpEvent) -> bool {
    use crate::acp::types::AcpEvent;
    let long = |body: &Option<String>| body.as_ref().is_some_and(|b| b.len() > STANDARD.max);
    let finished = |status: Option<&str>| matches!(status, Some("completed" | "failed"));
    match event {
        AcpEvent::ToolCall {
            status,
            content,
            raw_input,
            raw_output,
            images,
            ..
        } => {
            images.as_ref().is_some_and(|i| !i.is_empty())
                || (finished(Some(status))
                    && (long(content) || long(raw_input) || long(raw_output)))
        }
        AcpEvent::ToolCallUpdate {
            status,
            content,
            raw_input,
            raw_output,
            raw_output_append,
            images,
            ..
        } => {
            images.as_ref().is_some_and(|i| !i.is_empty())
                || (finished(status.as_deref())
                    && *raw_output_append != Some(true)
                    && (long(content) || long(raw_input) || long(raw_output)))
        }
        _ => false,
    }
}

/// Slim a serialized live `tool_call` / `tool_call_update` envelope for a
/// `wire: 2` subscriber: images by reference, and once the call has finished
/// its `raw_output`, `content` and `raw_input` shortened (references under
/// `body_refs`). Output appended to a running call is never touched — the
/// client is building that text up piece by piece.
pub fn slim_event(envelope: &mut Value, store: &BlobStore) {
    super::image_refs::project_images(envelope, store);
    let Value::Object(map) = envelope else {
        return;
    };
    let finished = matches!(
        map.get("status").and_then(Value::as_str),
        Some("completed" | "failed")
    );
    let appended = map.get("raw_output_append").and_then(Value::as_bool) == Some(true);
    if !finished || appended {
        return;
    }
    for field in ["raw_output", "content", "raw_input"] {
        shorten_string_field(map, field, STANDARD, store);
    }
}

// ─── Live snapshot ──────────────────────────────────────────────────────────

/// Slim a serialized `LiveSessionSnapshot` for a client that attached with
/// `wire: 2`: images by reference, and the bulky payload of FINISHED tool
/// calls shortened (calls still running are the client's to keep updating
/// and are never touched):
///
/// * `content` is dropped when the call has a non-empty `output` and no
///   images — the client shows `content` only for a call without output (an
///   image generation reads its revised prompt from it, hence the images
///   exception). The common Claude shape carries the same text in both.
/// * `output` (text, error message or JSON leaves), `content` and `input`
///   (JSON leaves) are shortened, newest calls with [`STANDARD`], and once
///   [`LIVE_TOOL_BUDGET`] is spent the older ones with [`SMALL`]; references
///   under `body_refs.{output,content,input}`. The `output` reference holds
///   the text a client rebuilds from the output (`{"error": …}` for an
///   error, the JSON text for a value), `input` the JSON text of the input.
/// * A `label` over 512 characters is cut when the call has an `input` (the
///   label is then only a title).
pub fn slim_snapshot(snapshot: &mut Value, store: &BlobStore) {
    super::image_refs::project_images(snapshot, store);

    let mut arrival: HashMap<String, usize> = HashMap::new();
    if let Some(Value::Array(blocks)) = snapshot.pointer("/live_message/content") {
        for (i, block) in blocks.iter().enumerate() {
            if block.get("kind").and_then(Value::as_str) == Some("tool_call_ref") {
                if let Some(id) = block.get("tool_call_id").and_then(Value::as_str) {
                    arrival.entry(id.to_string()).or_insert(i);
                }
            }
        }
    }
    let Some(Value::Array(calls)) = snapshot.get_mut("active_tool_calls") else {
        return;
    };
    let mut order: Vec<(usize, usize)> = calls
        .iter()
        .enumerate()
        .map(|(i, call)| {
            let rank = call
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| arrival.get(id).copied())
                .unwrap_or(usize::MAX);
            (rank, i)
        })
        .collect();
    order.sort_unstable();

    let mut spent = 0usize;
    for &(_, i) in order.iter().rev() {
        let Value::Object(call) = &mut calls[i] else {
            continue;
        };
        if is_finished(call) {
            let caps = if spent >= LIVE_TOOL_BUDGET {
                SMALL
            } else {
                STANDARD
            };
            slim_tool_call(call, caps, store);
        }
        spent = spent.saturating_add(json_len(call));
    }
}

/// An HTTP snapshot response, slimmed when `slim` (and the store is there);
/// projected on a blocking thread.
pub async fn respond_snapshot<T>(
    snapshot: Option<T>,
    slim: bool,
) -> Result<axum::response::Response, crate::app_error::AppCommandError>
where
    T: serde::Serialize + Send + 'static,
{
    use axum::response::IntoResponse as _;
    let store = match (slim, snapshot.is_some(), super::blob_store::global()) {
        (true, true, Some(store)) => store,
        _ => return Ok(axum::Json(snapshot).into_response()),
    };
    let projected = tokio::task::spawn_blocking(move || {
        let mut value = serde_json::to_value(&snapshot)?;
        slim_snapshot(&mut value, store);
        Ok::<_, serde_json::Error>(value)
    })
    .await
    .map_err(|e| crate::app_error::AppCommandError::io_error(e.to_string()))?
    .map_err(|e| crate::app_error::AppCommandError::io_error(e.to_string()))?;
    Ok(axum::Json(projected).into_response())
}

fn is_finished(call: &Map<String, Value>) -> bool {
    matches!(
        call.get("status").and_then(Value::as_str),
        Some("completed" | "failed")
    )
}

/// Whether a serialized `ToolCallOutput` has any text.
fn output_has_text(output: Option<&Value>) -> bool {
    let Some(Value::Object(out)) = output else {
        return false;
    };
    match out.get("kind").and_then(Value::as_str) {
        Some("text") => out
            .get("content")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty()),
        Some("error") => true,
        Some("json") => out.get("value").is_some_and(|v| !v.is_null()),
        _ => false,
    }
}

const MAX_LABEL_CHARS: usize = 512;

fn slim_tool_call(call: &mut Map<String, Value>, caps: Caps, store: &BlobStore) {
    let has_images = call
        .get("images")
        .and_then(Value::as_array)
        .is_some_and(|images| !images.is_empty());
    if output_has_text(call.get("output")) && !has_images {
        if let Some(content) = call.get_mut("content") {
            *content = Value::Null;
        }
    }

    let mut output_ref = None;
    if let Some(Value::Object(out)) = call.get_mut("output") {
        let kind = out.get("kind").and_then(Value::as_str).map(str::to_string);
        match kind.as_deref() {
            Some("text") if shorten_string_field(out, "content", caps, store) => {
                output_ref = take_ref(out, "content");
            }
            Some("error") => {
                // The client's text for an error is `{"error": message}`.
                if let Some(Value::String(message)) = out.get("message") {
                    if let Some(short) = shorten_text(message, caps) {
                        let full = json!({ "error": message }).to_string();
                        if let Some(reference) = reference(store, &full, 0) {
                            out.insert("message".into(), Value::String(short));
                            output_ref = Some(reference);
                        }
                    }
                }
            }
            Some("json") if shorten_value_field(out, "value", "value", caps, store) => {
                output_ref = take_ref(out, "value");
            }
            _ => {}
        }
    }
    if let Some(reference) = output_ref {
        add_ref(call, "output", reference);
    }
    shorten_string_field(call, "content", caps, store);
    shorten_value_field(call, "input", "input", caps, store);

    let has_input = call.get("input").is_some_and(|v| !v.is_null());
    if has_input {
        if let Some(Value::String(label)) = call.get_mut("label") {
            if label.chars().count() > MAX_LABEL_CHARS {
                let mut cut: String = label.chars().take(MAX_LABEL_CHARS).collect();
                cut.push(MARKER);
                *label = cut;
            }
        }
    }
}

/// Remove `body_refs[field]` from `map` (dropping an emptied map) and return it.
fn take_ref(map: &mut Map<String, Value>, field: &str) -> Option<Value> {
    let Some(Value::Object(refs)) = map.get_mut("body_refs") else {
        return None;
    };
    let reference = refs.remove(field);
    if refs.is_empty() {
        map.remove("body_refs");
    }
    reference
}

/// Serialized size of `map`, without building the string.
fn json_len(map: &Map<String, Value>) -> usize {
    struct Count(usize);
    impl std::io::Write for Count {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0 += buf.len();
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut count = Count(0);
    let _ = serde_json::to_writer(&mut count, map);
    count.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, BlobStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        (dir, store)
    }

    fn lines(n: usize) -> String {
        (1..=n)
            .map(|i| format!("{i:>6} some output line\n"))
            .collect()
    }

    fn full_text(store: &BlobStore, reference: &Value) -> String {
        let id = reference["id"].as_str().unwrap();
        String::from_utf8(store.read(BlobKind::Text, id).unwrap()).unwrap()
    }

    #[test]
    fn text_keeps_its_start_and_end_cut_at_line_ends() {
        let text = lines(5000);
        let short = shorten_text(&text, STANDARD).unwrap();
        assert!(short.len() <= STANDARD.head + STANDARD.tail + 8);
        assert!(short.starts_with("     1 some output line\n"));
        assert!(short.ends_with("  5000 some output line\n"));
        assert!(short.contains("\n…\n"), "the marker on a line of its own");
        for line in short.lines() {
            assert!(
                line == "…" || line.ends_with("some output line"),
                "{line:?}"
            );
        }
        assert!(shorten_text(&lines(10), STANDARD).is_none());
    }

    #[test]
    fn a_text_without_line_ends_is_cut_inside_and_on_char_boundaries() {
        let text = "é".repeat(20_000);
        let short = shorten_text(&text, STANDARD).unwrap();
        assert!(short.contains(" … "));
        assert!(short.starts_with('é') && short.ends_with('é'));
    }

    #[test]
    fn a_json_body_stays_valid_json() {
        let (_d, store) = store();
        let body = json!({ "start_line": 1, "content": lines(4000), "path": "a.rs" }).to_string();
        let mut block = json!({ "type": "tool_result", "output_preview": body });
        assert_eq!(project_turn_bodies(&mut block, &store), 1);
        let short = block["output_preview"].as_str().unwrap();
        let parsed: Value = serde_json::from_str(short).unwrap();
        assert_eq!(parsed["path"], "a.rs");
        assert_eq!(parsed["start_line"], 1);
        let reference = &block["body_refs"]["output_preview"];
        assert_eq!(full_text(&store, reference), body);
        assert_eq!(reference["bytes"], body.len());
        // The content leaf lost these line ends (escaped in the JSON text).
        let content = parsed["content"].as_str().unwrap();
        assert_eq!(
            reference["extra_lines"].as_i64().unwrap(),
            4000 - newlines(content) as i64
        );
    }

    #[test]
    fn detail_bodies_are_shortened_wherever_they_sit() {
        let (_d, store) = store();
        let big = lines(3000);
        let mut detail = json!({
            "turns": [{ "blocks": [
                { "type": "tool_use", "tool_name": "Write", "input_preview": json!({ "file_path": "x", "content": big }).to_string() },
                { "type": "tool_result", "output_preview": big, "agent_transcript": [
                    { "type": "tool_result", "output_preview": big },
                ] },
                { "type": "tool_result", "output_preview": "small" },
                { "type": "text", "text": big },
            ] }]
        });
        assert_eq!(project_turn_bodies(&mut detail, &store), 3);
        let blocks = &detail["turns"][0]["blocks"];
        assert!(blocks[0]["body_refs"]["input_preview"].is_object());
        let text = blocks[1]["output_preview"].as_str().unwrap();
        let reference = &blocks[1]["body_refs"]["output_preview"];
        assert_eq!(full_text(&store, reference), big);
        assert_eq!(
            newlines(text) as i64 + reference["extra_lines"].as_i64().unwrap(),
            3000,
            "the line count adds up"
        );
        assert!(blocks[1]["agent_transcript"][0]["body_refs"].is_object());
        assert!(blocks[2].get("body_refs").is_none());
        assert_eq!(blocks[3]["text"], big.as_str(), "only tool bodies");
    }

    #[test]
    fn a_big_json_of_small_leaves_is_left_whole() {
        let (_d, store) = store();
        let items: Vec<Value> = (0..5000).map(|i| json!({ "n": i, "s": "x" })).collect();
        let body = Value::Array(items).to_string();
        let mut block = json!({ "type": "tool_result", "output_preview": body });
        assert_eq!(project_turn_bodies(&mut block, &store), 0);
        assert_eq!(block["output_preview"], body.as_str());
    }

    fn call(id: &str, status: &str, output: Value, content: Option<&str>) -> Value {
        json!({
            "id": id, "kind": "execute", "label": "pnpm test", "status": status,
            "input": { "command": "pnpm test" },
            "output": output, "content": content,
            "locations": null, "meta": null, "images": [],
        })
    }

    #[test]
    fn a_live_snapshot_keeps_running_calls_and_shortens_finished_ones() {
        let (_d, store) = store();
        let big = lines(3000);
        let mut snapshot = json!({
            "live_message": { "content": [
                { "kind": "tool_call_ref", "tool_call_id": "a" },
                { "kind": "tool_call_ref", "tool_call_id": "b" },
                { "kind": "tool_call_ref", "tool_call_id": "c" },
                { "kind": "tool_call_ref", "tool_call_id": "d" },
            ] },
            "active_tool_calls": [
                call("a", "completed", json!({ "kind": "text", "content": big }), Some(&big)),
                call("b", "in_progress", json!({ "kind": "text", "content": big }), Some(&big)),
                call("c", "failed", json!({ "kind": "error", "message": big }), None),
                call("d", "completed", json!({ "kind": "json", "value": { "output": big, "exit": 0 } }), Some("ok")),
            ],
        });
        slim_snapshot(&mut snapshot, &store);
        let calls = snapshot["active_tool_calls"].as_array().unwrap();

        let a = &calls[0];
        assert!(a["content"].is_null(), "the duplicate content is dropped");
        let reference = &a["body_refs"]["output"];
        assert_eq!(full_text(&store, reference), big);
        assert!(a["output"]["content"].as_str().unwrap().len() < 21 * 1024);

        let b = &calls[1];
        assert_eq!(b["output"]["content"], big.as_str(), "running: untouched");
        assert_eq!(b["content"], big.as_str());
        assert!(b.get("body_refs").is_none());

        let c = &calls[2];
        assert_eq!(
            full_text(&store, &c["body_refs"]["output"]),
            json!({ "error": big }).to_string()
        );

        let d = &calls[3];
        assert_eq!(d["output"]["value"]["exit"], 0);
        let full: Value =
            serde_json::from_str(&full_text(&store, &d["body_refs"]["output"])).unwrap();
        assert_eq!(full, json!({ "output": big, "exit": 0 }));
        assert!(d["output"].get("body_refs").is_none());
    }

    #[test]
    fn older_finished_calls_get_the_small_cap_past_the_budget() {
        let (_d, store) = store();
        let body = lines(700); // ~16 KiB: under STANDARD, over SMALL
        let n = 60;
        let refs: Vec<Value> = (0..n)
            .map(|i| json!({ "kind": "tool_call_ref", "tool_call_id": format!("t{i}") }))
            .collect();
        let calls: Vec<Value> = (0..n)
            .map(|i| {
                call(
                    &format!("t{i}"),
                    "completed",
                    json!({ "kind": "text", "content": body }),
                    Some(&body),
                )
            })
            .collect();
        let mut snapshot =
            json!({ "live_message": { "content": refs }, "active_tool_calls": calls });
        slim_snapshot(&mut snapshot, &store);
        let calls = snapshot["active_tool_calls"].as_array().unwrap();
        assert!(calls[n - 1].get("body_refs").is_none(), "newest: whole");
        assert!(calls[0]["body_refs"]["output"].is_object(), "oldest: small");
        // The budget, one entry past it, then ~2 KiB per older entry — not
        // the 1 MB of the 60 whole.
        let total: usize = calls.iter().map(|c| c.to_string().len()).sum();
        assert!(total < LIVE_TOOL_BUDGET + 20 * 1024 + n * 2560, "{total}");
    }

    #[test]
    fn a_finished_tool_event_is_shortened_and_a_running_one_is_not() {
        use crate::acp::types::AcpEvent;
        let (_d, store) = store();
        let big = lines(3000);
        let update = |status: Option<&str>, append: Option<bool>| AcpEvent::ToolCallUpdate {
            tool_call_id: "t".into(),
            title: None,
            status: status.map(str::to_string),
            content: Some(big.clone()),
            raw_input: None,
            raw_output: Some(big.clone()),
            raw_output_append: append,
            locations: None,
            meta: None,
            images: None,
        };
        assert!(event_needs_slimming(&update(Some("completed"), None)));
        assert!(!event_needs_slimming(&update(Some("in_progress"), None)));
        assert!(!event_needs_slimming(&update(
            Some("completed"),
            Some(true)
        )));
        assert!(!event_needs_slimming(&AcpEvent::UsageUpdate {
            used: 1,
            size: 2
        }));

        let mut envelope = serde_json::to_value(crate::acp::types::EventEnvelope {
            seq: 7,
            connection_id: "c".into(),
            payload: update(Some("completed"), None),
        })
        .unwrap();
        slim_event(&mut envelope, &store);
        assert_eq!(envelope["seq"], 7);
        assert_eq!(envelope["type"], "tool_call_update");
        assert!(envelope["raw_output"].as_str().unwrap().len() < 24 * 1024);
        assert_eq!(full_text(&store, &envelope["body_refs"]["raw_output"]), big);
        assert_eq!(full_text(&store, &envelope["body_refs"]["content"]), big);

        let mut running = serde_json::to_value(crate::acp::types::EventEnvelope {
            seq: 8,
            connection_id: "c".into(),
            payload: update(Some("in_progress"), None),
        })
        .unwrap();
        slim_event(&mut running, &store);
        assert_eq!(running["raw_output"], big.as_str());
        assert!(running.get("body_refs").is_none());
    }

    #[test]
    fn a_long_label_is_cut_only_when_the_input_says_the_rest() {
        let (_d, store) = store();
        let label = "x".repeat(2000);
        let mut with_input = call("a", "completed", Value::Null, None);
        with_input["label"] = json!(label);
        let mut without = with_input.clone();
        without["input"] = Value::Null;
        let mut snapshot = json!({ "active_tool_calls": [with_input, without] });
        slim_snapshot(&mut snapshot, &store);
        let calls = &snapshot["active_tool_calls"];
        assert_eq!(calls[0]["label"].as_str().unwrap().chars().count(), 513);
        assert_eq!(calls[1]["label"], label.as_str());
    }
}
