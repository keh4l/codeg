use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use axum::{
    extract::{Extension, WebSocketUpgrade},
    response::IntoResponse,
};
use futures_util::{Sink, SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::shutdown::ShutdownSignal;
use super::ws_attach::{self, ClientMsg, DetachReason, ServerMsg, OUTBOUND_CAPACITY};
use crate::app_state::AppState;
use crate::logging::throttle::{LagLogThrottle, LAG_LOG_WINDOW};

/// One entry per live attach subscription. The `epoch` is the per-WS-session
/// monotonic counter assigned at spawn time; it threads through the cleanup
/// channel so a stale exit signal from a now-replaced handle cannot
/// accidentally remove the fresh handle. See the `cleanup_tx` comment in
/// `handle_ws_connection` for full rationale.
struct ActiveSubscription {
    handle: JoinHandle<()>,
    epoch: u64,
}

/// Apply a forwarder self-cleanup signal: remove the handle for `sub_id`
/// only if the stored epoch matches `signal_epoch`. Extracted from the
/// select! branch so the epoch-matching invariant has a unit test.
fn apply_cleanup_signal(
    subscriptions: &mut HashMap<String, ActiveSubscription>,
    sub_id: &str,
    signal_epoch: u64,
) {
    if let Some(sub) = subscriptions.get(sub_id) {
        if sub.epoch == signal_epoch {
            subscriptions.remove(sub_id);
        }
    }
}

// MUST match `WS_READY_CHANNEL` in `src/lib/transport/constants.ts`.
// Drift between the two values silently breaks the handshake (the client
// keeps waiting and falls back to the timeout warning path after 5 s).
//
// Phase 1: kept active in parallel with the new attach protocol so existing
// clients (web / remote desktop) continue to work while transports migrate.
// Phase 4 will retire this channel.
const WS_READY_CHANNEL: &str = "__ready__";

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Extension(state): Extension<Arc<AppState>>,
    Extension(shutdown_signal): Extension<Arc<ShutdownSignal>>,
) -> impl IntoResponse {
    ws.protocols([super::auth::WS_EVENT_PROTOCOL])
        .on_upgrade(|socket| handle_ws_connection(socket, state, shutdown_signal))
}

/// A WebSocket protocol-level ping goes out this often (fork). Browsers answer
/// it on their own, even from a throttled background tab, so it proves the
/// client is there without any page code running.
const SERVER_PING_INTERVAL: Duration = Duration::from_secs(30);

/// Close a socket the client has sent nothing on — no message, no pong — for
/// this long (fork). Frees the forwarders of a half-open socket (a laptop
/// that slept, a phone that changed networks) instead of feeding it forever.
const CLIENT_SILENCE_LIMIT: Duration = Duration::from_secs(90);

/// Capacity of the control lane. Pongs and shutdown detaches only; a full lane
/// means a pong is already waiting, so dropping another loses nothing.
const CONTROL_CAPACITY: usize = 64;

/// A frame for the writer's control lane, written ahead of queued data.
enum Control {
    Msg(ServerMsg),
    /// Write a close frame and stop.
    Close,
}

/// When the client last sent anything, as milliseconds since the socket
/// opened. Shared by the reader (which records) and the writer (which closes a
/// silent socket).
struct LastHeard {
    // tokio's clock, so paused-time tests can drive it.
    opened: tokio::time::Instant,
    ms: AtomicU64,
}

impl LastHeard {
    fn new() -> Self {
        Self {
            opened: tokio::time::Instant::now(),
            ms: AtomicU64::new(0),
        }
    }

    fn touch(&self) {
        self.ms
            .store(self.opened.elapsed().as_millis() as u64, Ordering::Relaxed);
    }

    fn silent_for(&self) -> Duration {
        self.opened
            .elapsed()
            .saturating_sub(Duration::from_millis(self.ms.load(Ordering::Relaxed)))
    }
}

/// One WebSocket client: a reader (this task) and a writer task (fork).
///
/// They used to be one loop that both read the socket and wrote it, so a
/// large frame being written stopped the reading — a ping waited behind a
/// snapshot that, over a slow link, takes longer to send than the client's
/// pong deadline, and the client tore the socket down and asked for the
/// snapshot again. Now the reader never waits on a write: it answers pings
/// through the writer's control lane, which is written ahead of queued data,
/// and an attach's snapshot or replay is queued by its own forwarder.
async fn handle_ws_connection(
    mut socket: WebSocket,
    state: Arc<AppState>,
    shutdown_signal: Arc<ShutdownSignal>,
) {
    // Late handshake guard: if shutdown already fired before this task
    // even started, exit before subscribing to anything else.
    if shutdown_signal.is_triggered() {
        let _ = socket.send(Message::Close(None)).await;
        return;
    }

    // Legacy global firehose subscriber. Removed in Phase 4 once all
    // transports use the attach protocol.
    let global_rx = state.event_broadcaster.subscribe();

    // Data lane: per-attach forwarders push their snapshot/replay and then
    // `Event`/`Detached` frames here; the writer drains it.
    let (outbound_tx, outbound_rx) = mpsc::channel::<ServerMsg>(OUTBOUND_CAPACITY);
    // Control lane: pongs and shutdown, written before anything queued above.
    let (control_tx, control_rx) = mpsc::channel::<Control>(CONTROL_CAPACITY);

    // Cleanup channel: forwarders signal `(subscription_id, epoch)` here
    // when they self-exit (lagged / channel closed) so the reader drops
    // the now-completed `JoinHandle` from `subscriptions`. Without this,
    // dead handles would sit in the map until socket close. Sized at
    // OUTBOUND_CAPACITY which comfortably covers a burst of simultaneous
    // forwarder exits; on overflow the forwarder's `try_send` no-ops and
    // the socket-close drain still reaps everything.
    //
    // The epoch is what makes the cleanup race-free. `JoinHandle::is_finished()`
    // looked tempting but is racy on multi-threaded Tokio — the cleanup
    // signal can land before the runtime has marked the JoinHandle's slot
    // finished. Instead, each Attach allocates a fresh u64 epoch (monotonic
    // per WS session) and stores it alongside the handle. The cleanup
    // branch only removes when the stored epoch matches the signal's
    // epoch — re-attaching with the same subscription_id stamps a new
    // epoch so any stale signal from the previous handle becomes a no-op.
    let (cleanup_tx, mut cleanup_rx) = mpsc::channel::<(String, u64)>(OUTBOUND_CAPACITY);

    // Track active attach subscriptions on this socket so a `detach`
    // message can abort the matching forwarder task and so we can clean
    // them all up on socket close. Each entry stores the forwarder's
    // epoch (see cleanup channel above) alongside the JoinHandle.
    let mut subscriptions: HashMap<String, ActiveSubscription> = HashMap::new();
    let mut next_epoch: u64 = 0;

    // Server→client ready handshake (legacy `__ready__` frame). Phase 1
    // keeps this so unmigrated transports still gate `acp_connect` on the
    // server-side receiver being subscribed. New attach-protocol clients
    // ignore this frame (channel name doesn't match any attach payload).
    let ready_payload = serde_json::json!({
        "channel": WS_READY_CHANNEL,
        "payload": null,
    });
    match serde_json::to_string(&ready_payload) {
        Ok(text) => {
            if let Err(e) = socket.send(Message::Text(text.into())).await {
                tracing::warn!("[WS][WARN] failed to send __ready__ frame: {e}");
                return;
            }
        }
        Err(e) => {
            tracing::warn!("[WS][WARN] failed to serialize __ready__ frame: {e}");
            return;
        }
    }

    let (sink, mut stream) = socket.split();
    let last_heard = Arc::new(LastHeard::new());
    let mut writer = tokio::spawn(run_writer(
        sink,
        control_rx,
        outbound_rx,
        global_rx,
        Arc::clone(&last_heard),
        SERVER_PING_INTERVAL,
        CLIENT_SILENCE_LIMIT,
    ));
    let mut writer_done = false;

    loop {
        tokio::select! {
            // Server-initiated shutdown: notify any active attach
            // subscriptions before closing so the client can decide
            // whether to retry on the next reconnect.
            _ = shutdown_signal.wait() => {
                for sub_id in subscriptions.keys() {
                    let frame = ServerMsg::Detached {
                        subscription_id: sub_id.clone(),
                        reason: DetachReason::ServerShutdown,
                    };
                    let _ = control_tx.send(Control::Msg(frame)).await;
                }
                let _ = control_tx.send(Control::Close).await;
                break;
            }

            // The writer stopped: the socket is gone, or it closed a silent one.
            _ = &mut writer => {
                writer_done = true;
                break;
            }

            // Forwarder self-cleanup: a per-attach task that exited (Lagged
            // or broadcast Closed) reports `(sub_id, epoch)` so we can
            // drop the dead JoinHandle. The epoch match guarantees we
            // only remove the handle the signal was actually for —
            // a re-attach between the dead forwarder's exit and this
            // recv would have stamped a new epoch, making the stale
            // signal a no-op.
            cleanup = cleanup_rx.recv() => {
                if let Some((sub_id, signal_epoch)) = cleanup {
                    apply_cleanup_signal(&mut subscriptions, &sub_id, signal_epoch);
                }
            }

            // Client-→-server messages. Text frames are parsed as
            // `ClientMsg`; every frame, pongs included, counts as the client
            // being there.
            msg = stream.next() => {
                match msg {
                    Some(Ok(message)) => {
                        last_heard.touch();
                        match message {
                            Message::Text(text) => match serde_json::from_str::<ClientMsg>(&text) {
                                Ok(cmsg) => {
                                    handle_client_msg(
                                        cmsg,
                                        &state,
                                        &outbound_tx,
                                        &control_tx,
                                        &cleanup_tx,
                                        &mut subscriptions,
                                        &mut next_epoch,
                                    )
                                    .await;
                                }
                                Err(e) => {
                                    tracing::warn!("[WS][WARN] malformed client message: {e}");
                                }
                            },
                            Message::Close(_) => break,
                            // Binary / ping / pong: nothing to do beyond the
                            // liveness stamp (axum answers pings itself).
                            _ => {}
                        }
                    }
                    _ => break,
                }
            }
        }
    }

    // Cleanup: abort all active forwarder tasks. Their broadcast receivers
    // will be dropped, freeing the per-connection broadcaster slot.
    for (_, sub) in subscriptions.drain() {
        sub.handle.abort();
    }
    // With every sender gone the writer drains what is queued (the shutdown
    // detaches and close, if any) and stops; give it a moment, then stop it.
    drop(control_tx);
    drop(outbound_tx);
    if !writer_done
        && tokio::time::timeout(Duration::from_secs(2), &mut writer)
            .await
            .is_err()
    {
        writer.abort();
    }
}

/// The socket's only writer (fork). Control frames go first; then queued
/// attach frames and the legacy firehose, fairly; a protocol ping every
/// `ping_every`; and the socket is closed once the client has been silent for
/// `silence_limit`. Returns when the socket is gone, on `Control::Close`, or
/// when both lanes have no senders left.
async fn run_writer<S>(
    mut sink: S,
    mut control_rx: mpsc::Receiver<Control>,
    mut outbound_rx: mpsc::Receiver<ServerMsg>,
    mut global_rx: tokio::sync::broadcast::Receiver<super::event_bridge::WebEvent>,
    last_heard: Arc<LastHeard>,
    ping_every: Duration,
    silence_limit: Duration,
) where
    S: Sink<Message> + Unpin,
{
    // Throttles the per-connection global-firehose lag WARN so a slow client
    // reading behind a steady side-channel stream can't trickle near-duplicate
    // lines. Task-local: one instance per WS connection.
    let mut lag_throttle = LagLogThrottle::new(LAG_LOG_WINDOW);
    let mut ping = tokio::time::interval_at(tokio::time::Instant::now() + ping_every, ping_every);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut outbound_open = true;

    loop {
        // Everything on the control lane goes before anything else.
        loop {
            match control_rx.try_recv() {
                Ok(control) => {
                    if !write_control(&mut sink, control).await {
                        return;
                    }
                }
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => return,
            }
        }

        tokio::select! {
            control = control_rx.recv() => match control {
                Some(control) => {
                    if !write_control(&mut sink, control).await {
                        return;
                    }
                }
                None => return,
            },

            outgoing = outbound_rx.recv(), if outbound_open => match outgoing {
                Some(msg) => {
                    if !write_server_msg(&mut sink, &msg).await {
                        return;
                    }
                }
                None => outbound_open = false,
            },

            // Legacy global firehose. Forwarded as-is (uses the old
            // `WebEvent { channel, payload }` shape, not the attach
            // protocol's `ServerMsg`).
            result = global_rx.recv() => match result {
                Ok(event) => {
                    if let Ok(msg) = serde_json::to_string(&event) {
                        if sink.send(Message::Text(msg.into())).await.is_err() {
                            return;
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    if let Some(s) = lag_throttle.record(n) {
                        tracing::warn!(
                            "[WS][WARN] global receiver lagged: skipped {} events across \
                             {} occurrence(s) in the last {}s",
                            s.dropped,
                            s.occurrences,
                            LAG_LOG_WINDOW.as_secs()
                        );
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            },

            _ = ping.tick() => {
                if last_heard.silent_for() >= silence_limit {
                    tracing::info!(
                        "[WS] closing a socket silent for {}s",
                        last_heard.silent_for().as_secs()
                    );
                    let _ = sink.send(Message::Close(None)).await;
                    return;
                }
                if sink.send(Message::Ping(Default::default())).await.is_err() {
                    return;
                }
            }
        }
    }
}

/// Write one control-lane item. `false` means stop: the socket is gone or the
/// item was a close.
async fn write_control<S>(sink: &mut S, control: Control) -> bool
where
    S: Sink<Message> + Unpin,
{
    match control {
        Control::Msg(msg) => write_server_msg(sink, &msg).await,
        Control::Close => {
            let _ = sink.send(Message::Close(None)).await;
            false
        }
    }
}

/// Serialize one frame onto the socket. `false` once the socket is gone; a
/// frame that fails to serialize is logged and skipped.
async fn write_server_msg<S>(socket: &mut S, msg: &ServerMsg) -> bool
where
    S: Sink<Message> + Unpin,
{
    match serde_json::to_string(msg) {
        Ok(text) => socket.send(Message::Text(text.into())).await.is_ok(),
        Err(e) => {
            tracing::warn!("[WS][WARN] failed to serialize ServerMsg: {e}");
            true
        }
    }
}

/// Handle one client message. Never waits on the socket: frames go to the
/// writer's lanes (fork).
async fn handle_client_msg(
    msg: ClientMsg,
    state: &Arc<AppState>,
    outbound_tx: &mpsc::Sender<ServerMsg>,
    control_tx: &mpsc::Sender<Control>,
    cleanup_tx: &mpsc::Sender<(String, u64)>,
    subscriptions: &mut HashMap<String, ActiveSubscription>,
    next_epoch: &mut u64,
) {
    match msg {
        ClientMsg::Attach {
            subscription_id,
            connection_id,
            since_seq,
        } => {
            // Re-attach with the same subscription_id replaces the prior
            // forwarder. Abort the old one first so its receiver drops
            // and we don't leak a broadcaster slot.
            if let Some(old) = subscriptions.remove(&subscription_id) {
                old.handle.abort();
            }

            match ws_attach::handle_attach(
                &state.connection_manager,
                state.acp_event_bus.metrics(),
                subscription_id.clone(),
                connection_id,
                since_seq,
            )
            .await
            {
                Ok(outcome) => {
                    // Allocate a fresh epoch for this spawn. wrapping_add is
                    // defensive — u64 overflow per WS session is impossible
                    // in practice (would require ~10^19 attaches on one
                    // socket) but the wrap behavior is well-defined and
                    // matches our epoch-equality semantics.
                    *next_epoch = next_epoch.wrapping_add(1);
                    let epoch = *next_epoch;
                    // The forwarder queues the snapshot/replay first, so the
                    // client sees state before the first live event.
                    let handle = ws_attach::spawn_forwarder(
                        subscription_id.clone(),
                        epoch,
                        state.acp_event_bus.metrics().clone(),
                        Some(outcome.initial_msg),
                        outcome.receiver,
                        outbound_tx.clone(),
                        cleanup_tx.clone(),
                        ws_attach::default_coalesce_window(),
                    );
                    subscriptions.insert(subscription_id, ActiveSubscription { handle, epoch });
                }
                Err(reason) => {
                    let frame = ServerMsg::Detached {
                        subscription_id,
                        reason,
                    };
                    let tx = outbound_tx.clone();
                    tokio::spawn(async move {
                        let _ = tx.send(frame).await;
                    });
                }
            }
        }
        ClientMsg::Detach { subscription_id } => {
            if let Some(sub) = subscriptions.remove(&subscription_id) {
                sub.handle.abort();
            }
        }
        ClientMsg::Ping => {
            // A full control lane already holds a pong for this client.
            let _ = control_tx.try_send(Control::Msg(ServerMsg::Pong));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build an ActiveSubscription wrapping a no-op spawned task. The
    /// JoinHandle is real so abort() in cleanup paths is realistic.
    async fn dummy_sub(epoch: u64) -> ActiveSubscription {
        let handle = tokio::spawn(async {
            // Park forever; aborted by cleanup paths or dropped at test end.
            std::future::pending::<()>().await;
        });
        ActiveSubscription { handle, epoch }
    }

    #[tokio::test]
    async fn cleanup_signal_with_matching_epoch_removes_entry() {
        let mut subs = HashMap::new();
        subs.insert("sub-A".to_string(), dummy_sub(1).await);

        apply_cleanup_signal(&mut subs, "sub-A", 1);

        assert!(!subs.contains_key("sub-A"));
    }

    #[tokio::test]
    async fn cleanup_signal_with_stale_epoch_keeps_fresh_handle() {
        // Simulate the race: old forwarder exited with epoch=1; client
        // re-attached and a new forwarder was spawned with epoch=2 in the
        // same map slot. The old cleanup signal must NOT remove the fresh
        // handle, otherwise the new forwarder is orphaned.
        let mut subs = HashMap::new();
        let fresh = dummy_sub(2).await;
        subs.insert("sub-A".to_string(), fresh);

        apply_cleanup_signal(&mut subs, "sub-A", 1);

        assert!(
            subs.contains_key("sub-A"),
            "stale cleanup must not evict the freshly re-attached handle"
        );
        assert_eq!(subs.get("sub-A").unwrap().epoch, 2);
    }

    #[tokio::test]
    async fn cleanup_signal_for_unknown_sub_id_is_noop() {
        let mut subs = HashMap::new();
        subs.insert("other".to_string(), dummy_sub(1).await);

        apply_cleanup_signal(&mut subs, "missing", 1);

        assert!(subs.contains_key("other"));
    }

    fn detached(subscription_id: &str) -> ServerMsg {
        ServerMsg::Detached {
            subscription_id: subscription_id.to_string(),
            reason: DetachReason::Lagged,
        }
    }

    fn frame_text(frame: &Message) -> &str {
        match frame {
            Message::Text(text) => text.as_str(),
            other => panic!("expected a text frame, got {other:?}"),
        }
    }

    struct Writer {
        control: mpsc::Sender<Control>,
        outbound: mpsc::Sender<ServerMsg>,
        frames: futures::channel::mpsc::UnboundedReceiver<Message>,
        task: JoinHandle<()>,
        last_heard: Arc<LastHeard>,
        _global: tokio::sync::broadcast::Sender<super::super::event_bridge::WebEvent>,
    }

    /// A writer over a channel sink, with `queued` data frames already waiting
    /// when it starts.
    fn writer(
        queued: Vec<ServerMsg>,
        control: Vec<Control>,
        ping: Duration,
        silence: Duration,
    ) -> Writer {
        let (control_tx, control_rx) = mpsc::channel(CONTROL_CAPACITY);
        let (outbound_tx, outbound_rx) = mpsc::channel(OUTBOUND_CAPACITY);
        for msg in queued {
            outbound_tx.try_send(msg).unwrap();
        }
        for c in control {
            control_tx
                .try_send(c)
                .unwrap_or_else(|_| panic!("control lane full"));
        }
        let (global_tx, global_rx) = tokio::sync::broadcast::channel(16);
        let (sink, frames) = futures::channel::mpsc::unbounded::<Message>();
        let last_heard = Arc::new(LastHeard::new());
        let task = tokio::spawn(run_writer(
            sink,
            control_rx,
            outbound_rx,
            global_rx,
            Arc::clone(&last_heard),
            ping,
            silence,
        ));
        Writer {
            control: control_tx,
            outbound: outbound_tx,
            frames,
            task,
            last_heard,
            _global: global_tx,
        }
    }

    async fn next(frames: &mut futures::channel::mpsc::UnboundedReceiver<Message>) -> Message {
        tokio::time::timeout(Duration::from_secs(5), frames.next())
            .await
            .expect("a frame within 5s")
            .expect("writer still open")
    }

    /// A pong for the client's heartbeat must not wait behind a full queue of
    /// data (on a slow link, behind a snapshot that takes longer to send than
    /// the client waits).
    #[tokio::test]
    async fn a_pong_goes_out_before_frames_already_queued() {
        let queued = (0..OUTBOUND_CAPACITY)
            .map(|i| detached(&format!("sub-{i}")))
            .collect();
        let mut w = writer(
            queued,
            vec![Control::Msg(ServerMsg::Pong)],
            Duration::from_secs(3600),
            Duration::from_secs(3600),
        );
        let first = next(&mut w.frames).await;
        assert!(frame_text(&first).contains("\"pong\""), "{first:?}");
        let second = next(&mut w.frames).await;
        assert!(frame_text(&second).contains("\"sub-0\""));
        w.task.abort();
    }

    /// Mid-stream, a pong queued after data overtakes everything not yet
    /// written.
    #[tokio::test]
    async fn a_pong_overtakes_data_queued_before_it() {
        let mut w = writer(
            Vec::new(),
            Vec::new(),
            Duration::from_secs(3600),
            Duration::from_secs(3600),
        );
        for i in 0..10 {
            w.outbound
                .send(detached(&format!("sub-{i}")))
                .await
                .unwrap();
        }
        w.control.send(Control::Msg(ServerMsg::Pong)).await.unwrap();
        let mut seen = Vec::new();
        for _ in 0..11 {
            seen.push(frame_text(&next(&mut w.frames).await).to_string());
        }
        let pong_at = seen.iter().position(|f| f.contains("\"pong\"")).unwrap();
        assert!(pong_at < 10, "pong written at {pong_at} of 11: {seen:?}");
        w.task.abort();
    }

    #[tokio::test]
    async fn close_on_the_control_lane_closes_and_stops() {
        let mut w = writer(
            vec![detached("queued")],
            vec![Control::Close],
            Duration::from_secs(3600),
            Duration::from_secs(3600),
        );
        assert!(matches!(next(&mut w.frames).await, Message::Close(_)));
        tokio::time::timeout(Duration::from_secs(5), &mut w.task)
            .await
            .expect("writer stops after a close")
            .unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn pings_while_the_client_answers_and_closes_a_silent_socket() {
        let mut w = writer(
            Vec::new(),
            Vec::new(),
            Duration::from_secs(30),
            Duration::from_secs(90),
        );
        // Let the writer start (and arm its ping timer) before time moves.
        for _ in 0..5 {
            tokio::task::yield_now().await;
        }
        // The client answers each ping: the socket stays.
        for _ in 0..4 {
            tokio::time::advance(Duration::from_secs(30)).await;
            assert!(matches!(next(&mut w.frames).await, Message::Ping(_)));
            w.last_heard.touch();
        }
        // Then nothing: after 90 s of silence the writer closes and stops.
        let mut closed = false;
        for _ in 0..5 {
            tokio::time::advance(Duration::from_secs(30)).await;
            match next(&mut w.frames).await {
                Message::Ping(_) => {}
                Message::Close(_) => {
                    closed = true;
                    break;
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        assert!(closed, "a silent socket is closed");
        tokio::time::timeout(Duration::from_secs(5), &mut w.task)
            .await
            .expect("writer stops")
            .unwrap();
    }

    #[tokio::test]
    async fn writer_stops_when_the_socket_is_gone() {
        let w = writer(
            Vec::new(),
            Vec::new(),
            Duration::from_secs(3600),
            Duration::from_secs(3600),
        );
        drop(w.frames);
        w.outbound.send(detached("x")).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), w.task)
            .await
            .expect("writer notices the socket is gone")
            .unwrap();
    }
}
