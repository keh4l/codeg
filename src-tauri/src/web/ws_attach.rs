//! WS attach protocol — Phase 1 of the Subscribe-with-Snapshot redesign.
//!
//! Replaces the legacy "subscribe to a global firehose + fetch HTTP snapshot
//! separately" flow. A client expressing interest in a specific connection
//! sends an `attach` message; the server atomically (under the SessionState
//! read lock) decides between a `snapshot` or `replay` response and
//! registers a per-connection broadcast receiver. After the response, live
//! events from that connection are delivered as `event` frames over the
//! same WebSocket.
//!
//! The legacy global `acp://event` channel remains active during Phase 1-3
//! for backward compatibility; Phase 4 retires it.

use std::sync::atomic::Ordering;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::acp::internal_bus::EventBusMetrics;
use crate::acp::manager::ConnectionManager;
use crate::acp::session_state::LiveSessionSnapshot;
use crate::acp::types::EventEnvelope;

use super::ws_coalesce::{self, Run, WireEnvelope};

/// Largest `replay` (fork): at most this many wire envelopes and this many
/// estimated bytes, after merging streamed text (`ws_coalesce`). A bigger gap
/// falls through to a `snapshot` even when the ring buffer covers it.
///
/// This replaced a flat 32-event limit, under which a reconnect a few seconds
/// into a streamed reply already took a snapshot of the whole live turn —
/// hundreds of KB with tool output — however little had changed. Merged, a
/// minute of streaming text is a handful of envelopes, so the limits now
/// follow what the client is missing rather than how it was chunked.
pub const REPLAY_MAX_ITEMS: usize = 512;
pub const REPLAY_MAX_BYTES: usize = 512 * 1024;

/// Default window for merging streamed text on the live stream (fork). The
/// first chunk after a quiet spell goes out at once; chunks arriving within
/// this long of the last frame are held and merged into the next one. So a
/// stream costs at most ~10 frames a second, and text is never held longer
/// than this. `CODEG_WS_COALESCE_MS` overrides it; `0` sends every chunk as
/// its own frame.
pub const DEFAULT_COALESCE_MS: u64 = 100;

/// The merge window for a subscription: what the client asked for (capped at
/// 1000 ms), else the server default.
pub fn coalesce_window(requested_ms: Option<u64>) -> Duration {
    match requested_ms {
        Some(ms) => Duration::from_millis(ms.min(1000)),
        None => default_coalesce_window(),
    }
}

/// The server-wide merge window (`CODEG_WS_COALESCE_MS`, read once).
pub fn default_coalesce_window() -> Duration {
    static WINDOW: OnceLock<Duration> = OnceLock::new();
    *WINDOW.get_or_init(|| {
        let ms = std::env::var("CODEG_WS_COALESCE_MS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(DEFAULT_COALESCE_MS);
        Duration::from_millis(ms.min(1000))
    })
}

/// Capacity of the per-WS-connection outbound mpsc channel. Backpressure
/// from a slow WS write naturally throttles per-subscription forwarders;
/// 64 in-flight messages is enough for short bursts without making
/// memory blow up if the client stops reading.
pub const OUTBOUND_CAPACITY: usize = 64;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ClientMsg {
    /// Subscribe this WebSocket to a specific connection's event stream.
    /// `since_seq` allows incremental catch-up after a brief disconnect;
    /// `None` requests a full snapshot.
    Attach {
        subscription_id: String,
        connection_id: String,
        #[serde(default)]
        since_seq: Option<u64>,
        /// Merge window for streamed text on this subscription, in ms (fork;
        /// v2 clients). Absent: the server default. Capped at 1000.
        #[serde(default)]
        coalesce_ms: Option<u64>,
        /// Payload shape this client reads (fork). `2`: the snapshot has its
        /// images by reference and finished tool calls' bulky payload
        /// shortened (`web::body_caps::slim_snapshot`). Absent: as before.
        #[serde(default)]
        wire: Option<u8>,
    },
    /// Cancel a prior `attach` by `subscription_id`.
    Detach { subscription_id: String },
    /// Liveness check. Server replies with `pong`.
    Ping,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    /// Initial state for `attach` (cold start, large gap, or cursor invalid).
    /// `event_seq` is the high-water mark; subsequent `event` frames carry
    /// `seq > event_seq`. The snapshot is `Box`'d so the enum variant size
    /// doesn't dominate every other (small) variant.
    Snapshot {
        subscription_id: String,
        connection_id: String,
        snapshot: Box<LiveSessionSnapshot>,
        event_seq: u64,
    },
    /// Batched catch-up for a small gap. `high_water_seq` is the largest
    /// seq in `events`; subsequent `event` frames carry `seq > high_water_seq`.
    /// Adjacent streamed text in `events` is merged (`ws_coalesce`).
    Replay {
        subscription_id: String,
        connection_id: String,
        events: Vec<WireEnvelope>,
        high_water_seq: u64,
    },
    /// Live event delivered after the initial Snapshot/Replay frame; may be
    /// several adjacent text chunks merged (`ws_coalesce`).
    Event {
        subscription_id: String,
        envelope: WireEnvelope,
    },
    /// Subscription was terminated by the server. `reason` is a stable code
    /// the client maps to UX (re-attach vs. drop the conversation).
    Detached {
        subscription_id: String,
        reason: DetachReason,
    },
    /// Liveness response.
    Pong,
    /// A frame already serialized (fork): a snapshot projected for a
    /// `wire: 2` client. Written as is; never goes through serde.
    #[serde(skip)]
    Raw(String),
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DetachReason {
    /// `connection_id` is unknown to the manager (possibly GC'd, possibly
    /// never existed). Client should treat this as a terminal state for
    /// the conversation.
    ConnectionGone,
    /// The per-connection broadcast channel dropped events because this
    /// subscriber couldn't keep up. Client must re-attach with its
    /// `lastAppliedSeq` to resync.
    Lagged,
    /// Server is shutting down. Reconnect after the next handshake.
    ServerShutdown,
}

/// Decision returned by the attach handler describing what frame to send
/// back to the client and which `broadcast::Receiver` to forward live
/// events from.
pub struct AttachOutcome {
    pub initial_msg: ServerMsg,
    pub receiver: tokio::sync::broadcast::Receiver<Arc<EventEnvelope>>,
}

/// Decide-and-subscribe under a single `SessionState` read lock. The
/// returned receiver is registered before the lock releases, so any event
/// fired after this function returns is delivered (no race against
/// `emit_with_state`'s write lock).
///
/// `metrics` records which response shape was returned (cold snapshot vs.
/// resumed replay vs. snapshot fallback) so operators can spot when the
/// replay limits (`REPLAY_MAX_ITEMS` / `REPLAY_MAX_BYTES`) or ring-buffer caps
/// need tuning.
pub async fn handle_attach(
    manager: &ConnectionManager,
    metrics: &EventBusMetrics,
    subscription_id: String,
    connection_id: String,
    since_seq: Option<u64>,
) -> Result<AttachOutcome, DetachReason> {
    let state_arc = manager
        .get_state(&connection_id)
        .await
        .ok_or(DetachReason::ConnectionGone)?;

    let s = state_arc.read().await;

    // Decide response shape. Order of checks matters:
    //   - explicit None → snapshot (fresh attach; client has no state yet)
    //   - cursor exactly at head → empty replay: the client already applied
    //     everything, so nothing but the cursor goes back (fork; this used to
    //     be a snapshot — the whole live turn re-sent on every idle reconnect,
    //     on a slow link a frame big enough to miss the heartbeat and force
    //     the next reconnect)
    //   - cursor past head → snapshot anyway, defends against client bugs
    //     where lastAppliedSeq was advanced past an event we never actually
    //     broadcast (not currently possible, but cheap to guard)
    //   - cursor in ring buffer with small gap → replay
    //   - cursor in ring buffer with large gap → snapshot (cheaper)
    //   - cursor older than ring buffer → snapshot (only choice)
    //   (fork: "small" is decided on the merged replay, `decide_resume`)
    let snapshot_msg = || ServerMsg::Snapshot {
        subscription_id: subscription_id.clone(),
        connection_id: connection_id.clone(),
        snapshot: Box::new(s.to_snapshot()),
        event_seq: s.event_seq,
    };

    let initial_msg = match since_seq {
        None => {
            metrics.snapshot_cold_count.fetch_add(1, Ordering::Relaxed);
            snapshot_msg()
        }
        Some(cursor) if cursor == s.event_seq => {
            metrics.replay_empty_count.fetch_add(1, Ordering::Relaxed);
            ServerMsg::Replay {
                subscription_id: subscription_id.clone(),
                connection_id: connection_id.clone(),
                events: Vec::new(),
                high_water_seq: s.event_seq,
            }
        }
        Some(cursor) if cursor > s.event_seq => {
            // Cursor past head — treat as fresh attach. Doesn't bump
            // `snapshot_fallback_count` because there's no gap-too-large
            // semantic; this is just a defensive equivalent of cold start.
            metrics.snapshot_cold_count.fetch_add(1, Ordering::Relaxed);
            snapshot_msg()
        }
        Some(cursor) => match decide_resume(s.recent_events_after(cursor)) {
            Some((events, event_count)) => {
                let high_water_seq = events
                    .last()
                    .expect("decide_resume never returns empty")
                    .seq();
                metrics.replay_count.fetch_add(1, Ordering::Relaxed);
                metrics
                    .replay_event_total
                    .fetch_add(event_count as u64, Ordering::Relaxed);
                ServerMsg::Replay {
                    subscription_id: subscription_id.clone(),
                    connection_id: connection_id.clone(),
                    events,
                    high_water_seq,
                }
            }
            // Either too many to batch, or buffer doesn't cover the cursor.
            _ => {
                metrics
                    .snapshot_fallback_count
                    .fetch_add(1, Ordering::Relaxed);
                snapshot_msg()
            }
        },
    };

    let receiver = s.event_stream().subscribe();
    drop(s);

    Ok(AttachOutcome {
        initial_msg,
        receiver,
    })
}

/// Whether a gap the ring buffer covers (`events`, `None` when it does not)
/// goes back as a replay: merged, it must be non-empty and within
/// `REPLAY_MAX_ITEMS` / `REPLAY_MAX_BYTES`. Returns the merged replay and how
/// many events it covers, or `None` for a snapshot.
pub fn decide_resume(
    events: Option<Vec<Arc<EventEnvelope>>>,
) -> Option<(Vec<WireEnvelope>, usize)> {
    let events = events?;
    if events.is_empty() {
        return None;
    }
    let covered = events.len();
    let merged = ws_coalesce::coalesce(events);
    if merged.len() > REPLAY_MAX_ITEMS {
        return None;
    }
    let bytes: usize = merged.iter().map(WireEnvelope::estimated_size).sum();
    if bytes > REPLAY_MAX_BYTES {
        return None;
    }
    Some((merged, covered))
}

/// Spawn a forwarding task that drains the per-connection broadcast receiver
/// and sends `Event` frames to the shared outbound channel. Exits on
/// receiver close (connection went away) or `Lagged` (slow consumer); in
/// both cases sends a `Detached` frame so the client knows to re-attach.
///
/// `cleanup_tx` carries `(subscription_id, epoch)` back to the WS main loop
/// on every self-exit path so the loop can drop the now-completed
/// `JoinHandle` from its `subscriptions` map. The `epoch` is critical: a
/// stale signal arriving after the client has re-attached (which replaces
/// the handle) would otherwise orphan the fresh forwarder. The main loop
/// only removes when the stored epoch matches the signal's epoch — re-attach
/// stamps a new epoch so old signals become no-ops. Without epoch matching,
/// `JoinHandle::is_finished()` is racy on multi-threaded runtimes (the
/// runtime may not have updated the JoinHandle slot yet when the cleanup
/// signal is consumed).
///
/// Send is `try_send` so a saturated cleanup channel never blocks the
/// exiting task; the socket-close `subscriptions.drain()` is the safety net.
///
/// `metrics` records `Lagged` exits so operators can correlate attach
/// re-attachment storms with per-connection broadcast pressure.
///
/// `initial` (the attach's snapshot or replay) is queued first, from this
/// task, so it stays ahead of the subscription's live events without the
/// socket's reader ever waiting on the outbound queue (fork: the reader used
/// to queue it itself, and a full queue then held up pings and detaches).
///
/// `coalesce` is the window for merging streamed text (fork, see
/// `DEFAULT_COALESCE_MS`; zero sends every event as received). Text is merged
/// only with the text right after it, so the order of everything the client
/// sees is unchanged; any other event first sends the text held before it.
/// While the socket is slow to drain, events wait in the broadcast receiver
/// and are merged as they are read, so a backlog leaves as fewer, larger
/// frames instead of falling further behind.
#[allow(clippy::too_many_arguments)]
/// A frame as a `wire: 2` client reads it (fork, `web::body_caps`): a
/// snapshot slimmed, and in a replay or an event every tool call with images
/// or a long finished body projected. Serialized off the runtime (the
/// projection hashes and stores each image and long body). Any other frame,
/// or every frame when the store is not there, as is.
async fn slim_frame(msg: ServerMsg) -> ServerMsg {
    use super::body_caps;
    let needs = |envelope: &WireEnvelope| {
        matches!(envelope, WireEnvelope::Single(env) if body_caps::event_needs_slimming(&env.payload))
    };
    let (subscription_id, wanted) = match &msg {
        ServerMsg::Snapshot {
            subscription_id, ..
        } => (subscription_id.clone(), true),
        ServerMsg::Replay {
            subscription_id,
            events,
            ..
        } => (subscription_id.clone(), events.iter().any(needs)),
        ServerMsg::Event {
            subscription_id,
            envelope,
        } => (subscription_id.clone(), needs(envelope)),
        _ => return msg,
    };
    if !wanted {
        return msg;
    }
    let Some(store) = super::blob_store::global() else {
        return msg;
    };
    let projected = tokio::task::spawn_blocking(move || {
        let mut value = match serde_json::to_value(&msg) {
            Ok(value) => value,
            Err(_) => return Err(msg),
        };
        if let Some(snapshot) = value.get_mut("snapshot") {
            body_caps::slim_snapshot(snapshot, store);
        }
        if let Some(Value::Array(events)) = value.get_mut("events") {
            for event in events {
                if is_tool_event(event) {
                    body_caps::slim_event(event, store);
                }
            }
        }
        if let Some(envelope) = value.get_mut("envelope") {
            body_caps::slim_event(envelope, store);
        }
        serde_json::to_string(&value).map_err(|_| msg)
    })
    .await;
    match projected {
        Ok(Ok(text)) => ServerMsg::Raw(text),
        Ok(Err(msg)) => msg,
        Err(err) => {
            // The frame went with the task; the client re-attaches.
            tracing::warn!("[WS attach] frame projection failed: {err}");
            ServerMsg::Detached {
                subscription_id,
                reason: DetachReason::Lagged,
            }
        }
    }
}

fn is_tool_event(event: &Value) -> bool {
    matches!(
        event.get("type").and_then(Value::as_str),
        Some("tool_call" | "tool_call_update")
    )
}

#[allow(clippy::too_many_arguments)]
pub fn spawn_forwarder(
    subscription_id: String,
    epoch: u64,
    metrics: Arc<EventBusMetrics>,
    initial: Option<ServerMsg>,
    mut receiver: tokio::sync::broadcast::Receiver<Arc<EventEnvelope>>,
    outbound: mpsc::Sender<ServerMsg>,
    cleanup_tx: mpsc::Sender<(String, u64)>,
    coalesce: Duration,
    slim: bool,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let signal_cleanup = || {
            let _ = cleanup_tx.try_send((subscription_id.clone(), epoch));
        };
        let event = |envelope: WireEnvelope| ServerMsg::Event {
            subscription_id: subscription_id.clone(),
            envelope,
        };
        if let Some(initial) = initial {
            let initial = if slim {
                slim_frame(initial).await
            } else {
                initial
            };
            if outbound.send(initial).await.is_err() {
                signal_cleanup();
                return;
            }
        }
        // Text held for merging, and when it must go out.
        let mut pending: Option<(Run, Instant)> = None;
        // When the last frame of this subscription was queued.
        let mut last_sent: Option<Instant> = None;
        let detach_reason = loop {
            let flush_at = pending.as_ref().map(|(_, at)| *at);
            let received = tokio::select! {
                // Read first: a backlog merges into what is pending instead
                // of being cut into window-sized frames.
                biased;
                received = receiver.recv() => received,
                _ = tokio::time::sleep_until(flush_at.unwrap_or_else(Instant::now)), if flush_at.is_some() => {
                    let (run, _) = pending.take().expect("a flush time implies pending text");
                    if outbound.send(event(run.finish())).await.is_err() {
                        signal_cleanup();
                        return;
                    }
                    last_sent = Some(Instant::now());
                    continue;
                }
            };
            let envelope = match received {
                Ok(envelope) => envelope,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(
                        "[WS attach] subscription {} lagged ({} events dropped); detaching",
                        subscription_id,
                        n
                    );
                    metrics
                        .forwarder_lagged_count
                        .fetch_add(1, Ordering::Relaxed);
                    break DetachReason::Lagged;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break DetachReason::ConnectionGone;
                }
            };
            if let Some((run, _)) = pending.as_mut() {
                if run.try_push(&envelope) {
                    continue;
                }
            }
            if let Some((run, _)) = pending.take() {
                if outbound.send(event(run.finish())).await.is_err() {
                    signal_cleanup();
                    return;
                }
                last_sent = Some(Instant::now());
            }
            let now = Instant::now();
            let quiet = last_sent.is_none_or(|at| now.duration_since(at) >= coalesce);
            if !coalesce.is_zero() && !quiet && ws_coalesce::is_mergeable(&envelope.payload) {
                let at = last_sent.map_or(now, |at| at + coalesce);
                pending = Some((Run::new(envelope), at));
                continue;
            }
            let mut msg = event(WireEnvelope::Single(envelope));
            if slim {
                msg = slim_frame(msg).await;
            }
            if outbound.send(msg).await.is_err() {
                // WS closed; nothing to forward to. Map cleanup is handled by
                // the main loop's drain on exit, but the signal is harmless
                // either way.
                signal_cleanup();
                return;
            }
            last_sent = Some(Instant::now());
        };
        // Text already received goes out before the detach, so the client's
        // cursor covers it and the re-attach does not ask for it again.
        if let Some((run, _)) = pending.take() {
            let _ = outbound.send(event(run.finish())).await;
        }
        let _ = outbound
            .send(ServerMsg::Detached {
                subscription_id: subscription_id.clone(),
                reason: detach_reason,
            })
            .await;
        signal_cleanup();
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::types::AcpEvent;
    use serde_json::Value;
    use tokio::sync::broadcast;

    fn text(seq: u64, t: &str) -> Arc<EventEnvelope> {
        Arc::new(EventEnvelope {
            seq,
            connection_id: "c".into(),
            payload: AcpEvent::ContentDelta {
                text: t.into(),
                parent_tool_use_id: None,
            },
        })
    }

    fn usage(seq: u64) -> Arc<EventEnvelope> {
        Arc::new(EventEnvelope {
            seq,
            connection_id: "c".into(),
            payload: AcpEvent::UsageUpdate { used: 1, size: 2 },
        })
    }

    struct Forwarder {
        events: broadcast::Sender<Arc<EventEnvelope>>,
        out: mpsc::Receiver<ServerMsg>,
        _cleanup: mpsc::Receiver<(String, u64)>,
    }

    fn forwarder(window_ms: u64) -> Forwarder {
        let (events, receiver) = broadcast::channel(64);
        let (out_tx, out) = mpsc::channel(64);
        let (cleanup_tx, cleanup) = mpsc::channel(4);
        spawn_forwarder(
            "s".into(),
            1,
            Arc::new(EventBusMetrics::default()),
            None,
            receiver,
            out_tx,
            cleanup_tx,
            Duration::from_millis(window_ms),
            false,
        );
        Forwarder {
            events,
            out,
            _cleanup: cleanup,
        }
    }

    async fn next(f: &mut Forwarder) -> Value {
        serde_json::to_value(f.out.recv().await.expect("a frame")).unwrap()
    }

    #[tokio::test(start_paused = true)]
    async fn first_chunk_goes_at_once_and_the_rest_within_the_window() {
        let mut f = forwarder(100);
        let start = Instant::now();
        f.events.send(text(1, "a")).unwrap();
        let first = next(&mut f).await;
        assert_eq!(first["envelope"]["text"], "a");
        assert!(first["envelope"].get("first_seq").is_none());
        assert_eq!(start.elapsed(), Duration::ZERO, "leading edge is not held");

        f.events.send(text(2, "b")).unwrap();
        f.events.send(text(3, "c")).unwrap();
        let merged = next(&mut f).await;
        assert_eq!(merged["type"], "event");
        assert_eq!(merged["envelope"]["text"], "bc");
        assert_eq!(merged["envelope"]["first_seq"], 2);
        assert_eq!(merged["envelope"]["seq"], 3);
        assert_eq!(
            start.elapsed(),
            Duration::from_millis(100),
            "held until one window after the last frame, no longer"
        );

        // A quiet spell: the next chunk is a leading edge again.
        tokio::time::sleep(Duration::from_millis(500)).await;
        let quiet = Instant::now();
        f.events.send(text(4, "d")).unwrap();
        assert_eq!(next(&mut f).await["envelope"]["text"], "d");
        assert_eq!(quiet.elapsed(), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn another_event_sends_the_held_text_first_without_waiting() {
        let mut f = forwarder(100);
        f.events.send(text(1, "a")).unwrap();
        next(&mut f).await;
        let start = Instant::now();
        f.events.send(text(2, "b")).unwrap();
        f.events.send(text(3, "c")).unwrap();
        f.events.send(usage(4)).unwrap();
        f.events.send(text(5, "d")).unwrap();
        let held = next(&mut f).await;
        assert_eq!(held["envelope"]["text"], "bc");
        assert_eq!(next(&mut f).await["envelope"]["type"], "usage_update");
        assert_eq!(start.elapsed(), Duration::ZERO, "a barrier flushes at once");
        let after = next(&mut f).await;
        assert_eq!(after["envelope"]["text"], "d");
        assert_eq!(after["envelope"]["seq"], 5);
    }

    #[tokio::test(start_paused = true)]
    async fn held_text_goes_out_before_the_detach() {
        let mut f = forwarder(100);
        f.events.send(text(1, "a")).unwrap();
        next(&mut f).await;
        f.events.send(text(2, "b")).unwrap();
        f.events.send(text(3, "c")).unwrap();
        drop(f.events);
        let mut frames = Vec::new();
        while let Some(frame) = f.out.recv().await {
            frames.push(serde_json::to_value(frame).unwrap());
        }
        assert_eq!(frames.len(), 2, "{frames:?}");
        assert_eq!(frames[0]["envelope"]["text"], "bc");
        assert_eq!(frames[1]["type"], "detached");
        assert_eq!(frames[1]["reason"], "connection_gone");
    }

    #[tokio::test(start_paused = true)]
    async fn a_zero_window_sends_every_chunk_as_received() {
        let mut f = forwarder(0);
        for seq in 1..=3 {
            f.events.send(text(seq, "x")).unwrap();
        }
        for seq in 1..=3 {
            let frame = next(&mut f).await;
            assert_eq!(frame["envelope"]["seq"], seq);
            assert!(frame["envelope"].get("first_seq").is_none());
        }
    }

    #[test]
    fn resume_replays_a_merged_gap_and_snapshots_past_the_limits() {
        assert!(decide_resume(None).is_none(), "the ring does not cover it");
        assert!(decide_resume(Some(Vec::new())).is_none());

        // Ten seconds of streaming at 50 chunks a second: 500 events, one
        // envelope merged.
        let streamed: Vec<_> = (1..=500).map(|seq| text(seq, "word ")).collect();
        let (replay, covered) = decide_resume(Some(streamed)).expect("replayed");
        assert_eq!(covered, 500);
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].seq(), 500);

        // Interleaved with other events, merging cannot help: past the item
        // limit it is a snapshot.
        let choppy: Vec<_> = (1..=(REPLAY_MAX_ITEMS as u64 + 2))
            .map(|seq| {
                if seq % 2 == 0 {
                    usage(seq)
                } else {
                    text(seq, "x")
                }
            })
            .collect();
        assert!(decide_resume(Some(choppy)).is_none());

        // Or past the byte limit.
        let big = "y".repeat(ws_coalesce::MAX_MERGED_TEXT);
        let heavy: Vec<_> = (1..=(REPLAY_MAX_BYTES / ws_coalesce::MAX_MERGED_TEXT) as u64 + 1)
            .map(|seq| text(seq, &big))
            .collect();
        assert!(decide_resume(Some(heavy)).is_none());
    }
}
