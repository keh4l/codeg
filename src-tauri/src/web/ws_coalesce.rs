//! Merging adjacent streamed text into one wire envelope (fork).
//!
//! A model streams its reply as many small chunks and codeg emits one event
//! per chunk, each with its own `seq`. Sent as they are, that is one WebSocket
//! frame per ~18 characters — about 58 frames per 1000 characters, each
//! repeating the same ~150-byte envelope — and a reconnect's replay of a few
//! seconds of streaming is hundreds of envelopes the client applies one by one.
//!
//! Adjacent `content_delta`s (or `thinking`s) with the same parent are merged
//! into one envelope: the text concatenated, `seq` the LAST chunk's, and
//! `first_seq` the first one's. A client's cursor rule stays "highest applied
//! seq", so a client that does not know `first_seq` applies the merged text
//! once and advances to `seq` — exactly what it would have ended at applying
//! the chunks one by one. Everything else (tool calls, permissions, turn ends,
//! status) is never merged and never reordered: it flushes whatever text is
//! pending first.
//!
//! Only the WebSocket wire is affected: events, their `seq`s, the session
//! state, the recent-events ring, desktop IPC and in-process consumers all see
//! every chunk as before.

use std::sync::Arc;

use serde::{Serialize, Serializer};

use crate::acp::types::{AcpEvent, EventEnvelope};

/// Longest merged text; past it the envelope goes out and a new one starts.
pub const MAX_MERGED_TEXT: usize = 32 * 1024;

/// An envelope as written to the WebSocket: one event, or several adjacent
/// text chunks merged (boxed: an `EventEnvelope` is several hundred bytes).
#[derive(Debug, Clone)]
pub enum WireEnvelope {
    Single(Arc<EventEnvelope>),
    Merged(Box<MergedEnvelope>),
}

/// `{ first_seq, seq, connection_id, type, text, ... }` — the last chunk's
/// envelope with the merged text, plus the first chunk's seq.
#[derive(Debug, Clone, Serialize)]
pub struct MergedEnvelope {
    pub first_seq: u64,
    #[serde(flatten)]
    pub envelope: EventEnvelope,
}

impl Serialize for WireEnvelope {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            WireEnvelope::Single(envelope) => envelope.serialize(serializer),
            WireEnvelope::Merged(merged) => merged.serialize(serializer),
        }
    }
}

impl WireEnvelope {
    /// The highest seq this envelope covers.
    pub fn seq(&self) -> u64 {
        match self {
            WireEnvelope::Single(envelope) => envelope.seq,
            WireEnvelope::Merged(merged) => merged.envelope.seq,
        }
    }

    /// Upper-bound estimate of the serialized size.
    pub fn estimated_size(&self) -> usize {
        match self {
            WireEnvelope::Single(envelope) => {
                crate::acp::event_stream::estimate_envelope_size(envelope)
            }
            WireEnvelope::Merged(merged) => {
                crate::acp::event_stream::estimate_envelope_size(&merged.envelope) + 32
            }
        }
    }
}

/// Text and parent of a mergeable event; `None` for everything else.
fn text_part(event: &AcpEvent) -> Option<(bool, &str, &Option<String>)> {
    match event {
        AcpEvent::ContentDelta {
            text,
            parent_tool_use_id,
        } => Some((false, text, parent_tool_use_id)),
        AcpEvent::Thinking {
            text,
            parent_tool_use_id,
        } => Some((true, text, parent_tool_use_id)),
        _ => None,
    }
}

/// Whether an event can ever take part in a merge.
pub fn is_mergeable(event: &AcpEvent) -> bool {
    text_part(event).is_some()
}

/// Builds one wire envelope out of a run of adjacent mergeable events.
#[derive(Debug)]
pub struct Run {
    first: Arc<EventEnvelope>,
    merged: Option<EventEnvelope>,
    text_len: usize,
}

impl Run {
    /// Start a run. `envelope` must be mergeable (callers check
    /// [`is_mergeable`]); a non-mergeable one makes a run of one.
    pub fn new(envelope: Arc<EventEnvelope>) -> Self {
        let text_len = text_part(&envelope.payload).map_or(0, |(_, t, _)| t.len());
        Run {
            first: envelope,
            merged: None,
            text_len,
        }
    }

    fn last_seq(&self) -> u64 {
        self.merged.as_ref().map_or(self.first.seq, |m| m.seq)
    }

    /// Append `next` if it continues this run: the very next seq, the same
    /// kind (text or thinking) and the same parent, and the merged text stays
    /// under [`MAX_MERGED_TEXT`]. Returns whether it was taken.
    pub fn try_push(&mut self, next: &EventEnvelope) -> bool {
        if next.seq != self.last_seq() + 1 || next.connection_id != self.first.connection_id {
            return false;
        }
        let Some((thinking, _, parent)) = text_part(&self.first.payload) else {
            return false;
        };
        let Some((next_thinking, next_text, next_parent)) = text_part(&next.payload) else {
            return false;
        };
        if thinking != next_thinking || parent != next_parent {
            return false;
        }
        if self.text_len + next_text.len() > MAX_MERGED_TEXT {
            return false;
        }
        let merged = self.merged.get_or_insert_with(|| (*self.first).clone());
        match &mut merged.payload {
            AcpEvent::ContentDelta { text, .. } | AcpEvent::Thinking { text, .. } => {
                text.push_str(next_text);
            }
            _ => unreachable!("a run only holds text"),
        }
        merged.seq = next.seq;
        self.text_len += next_text.len();
        true
    }

    pub fn finish(self) -> WireEnvelope {
        match self.merged {
            None => WireEnvelope::Single(self.first),
            Some(envelope) => WireEnvelope::Merged(Box::new(MergedEnvelope {
                first_seq: self.first.seq,
                envelope,
            })),
        }
    }
}

/// Merge a contiguous run of envelopes (a replay) into wire envelopes,
/// preserving order.
pub fn coalesce(events: Vec<Arc<EventEnvelope>>) -> Vec<WireEnvelope> {
    let mut out = Vec::new();
    let mut run: Option<Run> = None;
    for envelope in events {
        if let Some(current) = run.as_mut() {
            if current.try_push(&envelope) {
                continue;
            }
        }
        if let Some(done) = run.take() {
            out.push(done.finish());
        }
        if is_mergeable(&envelope.payload) {
            run = Some(Run::new(envelope));
        } else {
            out.push(WireEnvelope::Single(envelope));
        }
    }
    if let Some(done) = run {
        out.push(done.finish());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn env(seq: u64, payload: AcpEvent) -> Arc<EventEnvelope> {
        Arc::new(EventEnvelope {
            seq,
            connection_id: "c".into(),
            payload,
        })
    }

    fn text(seq: u64, t: &str) -> Arc<EventEnvelope> {
        env(
            seq,
            AcpEvent::ContentDelta {
                text: t.into(),
                parent_tool_use_id: None,
            },
        )
    }

    fn thought(seq: u64, t: &str) -> Arc<EventEnvelope> {
        env(
            seq,
            AcpEvent::Thinking {
                text: t.into(),
                parent_tool_use_id: None,
            },
        )
    }

    fn json(w: &WireEnvelope) -> Value {
        serde_json::to_value(w).unwrap()
    }

    #[test]
    fn adjacent_text_merges_into_one_envelope_with_the_last_seq() {
        let out = coalesce(vec![text(1, "a"), text(2, "b"), text(3, "c")]);
        assert_eq!(out.len(), 1);
        let v = json(&out[0]);
        assert_eq!(v["type"], "content_delta");
        assert_eq!(v["text"], "abc");
        assert_eq!(v["seq"], 3);
        assert_eq!(v["first_seq"], 1);
        assert_eq!(v["connection_id"], "c");
    }

    #[test]
    fn a_single_chunk_keeps_its_exact_shape() {
        let out = coalesce(vec![text(7, "solo")]);
        let v = json(&out[0]);
        assert!(v.get("first_seq").is_none(), "{v}");
        assert_eq!(
            v,
            serde_json::to_value(&*text(7, "solo")).unwrap(),
            "an unmerged envelope serializes exactly as before"
        );
    }

    #[test]
    fn other_events_are_barriers_and_keep_their_order() {
        let tool = env(3, AcpEvent::UsageUpdate { used: 1, size: 2 });
        let out = coalesce(vec![
            text(1, "a"),
            text(2, "b"),
            tool,
            text(4, "c"),
            text(5, "d"),
        ]);
        let types: Vec<Value> = out.iter().map(|w| json(w)["type"].clone()).collect();
        assert_eq!(types, ["content_delta", "usage_update", "content_delta"]);
        assert_eq!(json(&out[0])["text"], "ab");
        assert_eq!(json(&out[2])["text"], "cd");
        assert_eq!(json(&out[2])["first_seq"], 4);
    }

    #[test]
    fn text_and_thinking_and_different_parents_do_not_mix() {
        let child = env(
            3,
            AcpEvent::ContentDelta {
                text: "x".into(),
                parent_tool_use_id: Some("tool-1".into()),
            },
        );
        let out = coalesce(vec![
            thought(1, "t1"),
            thought(2, "t2"),
            child,
            text(4, "y"),
        ]);
        assert_eq!(out.len(), 3);
        assert_eq!(json(&out[0])["text"], "t1t2");
        assert_eq!(json(&out[1])["parent_tool_use_id"], "tool-1");
        assert_eq!(json(&out[2])["text"], "y");
    }

    #[test]
    fn a_gap_in_seq_ends_the_run() {
        let out = coalesce(vec![text(1, "a"), text(3, "b")]);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn a_run_stops_at_the_size_cap() {
        let big = "x".repeat(MAX_MERGED_TEXT / 2 + 1);
        let out = coalesce(vec![text(1, &big), text(2, &big), text(3, "z")]);
        assert_eq!(out.len(), 2, "the second chunk would pass the cap");
        assert_eq!(json(&out[1])["text"], format!("{big}z"));
    }

    #[test]
    fn merged_text_is_what_applying_every_chunk_gives() {
        let chunks: Vec<Arc<EventEnvelope>> =
            (1..=50).map(|i| text(i, &format!("<{i}>"))).collect();
        let expected: String = (1..=50).map(|i| format!("<{i}>")).collect();
        let out = coalesce(chunks);
        let got: String = out
            .iter()
            .map(|w| json(w)["text"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(got, expected);
        assert_eq!(out.last().unwrap().seq(), 50);
    }
}
