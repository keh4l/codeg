//! keh4l build: messages sent while the agent is replying (aligned with
//! T3 Code).
//!
//! - **Steer** ([`steer`]): into the running turn. The agent's native way
//!   first (upstream's `_session/steering` for Claude Code / Codex, and
//!   [`native`] for Grok / Kiro / Antigravity), else cancel the turn and send
//!   the message as the next prompt ([`restart`]), else queue it.
//! - **Queue** ([`enqueue`]): stored per conversation in `follow_up_queue` and
//!   sent by the server, one message per turn that ends normally — every
//!   window and device sees the same queue, and it survives a reload.
//! - **Hold**: a stop, a turn that ends in an error, or a server restart keeps
//!   the queue but stops sending until the user lets it go ([`resume`], or a
//!   new message). Held state lives in memory; a queue found in the database
//!   at startup starts held.
//!
//! Steers are recorded in `steer_record` so the transcript can mark them after
//! a reload. Changes reach the frontend as global side-channel events
//! ([`QUEUE_CHANGED_EVENT`], [`STEERS_CHANGED_EVENT`],
//! [`STEER_UNDELIVERED_EVENT`]).

pub mod native;
pub mod restart;
pub mod route;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use sea_orm::EntityTrait;
use serde::{Deserialize, Serialize};

use crate::acp::connection::ConnectionCommand;
use crate::acp::error::AcpError;
use crate::acp::internal_bus::InternalEventBus;
use crate::acp::manager::ConnectionManager;
use crate::acp::types::{AcpEvent, ConnectionStatus, PromptInputBlock};
use crate::app_error::AppCommandError;
use crate::db::entities::{conversation, follow_up_queue, steer_record};
use crate::db::service::follow_up_service::{self, NewItem};
use crate::db::AppDatabase;
use crate::web::event_bridge::{emit_event, EventEmitter};

use route::{SteerContext, SteerRoute, TurnEndAction};

pub const QUEUE_CHANGED_EVENT: &str = "follow-up://queue-changed";
pub const STEERS_CHANGED_EVENT: &str = "follow-up://steers-changed";
pub const STEER_UNDELIVERED_EVENT: &str = "follow-up://steer-undelivered";

/// Set (to anything) to steer every agent by interrupt-and-restart.
pub const FORCE_RESTART_ENV: &str = "CODEG_FOLLOW_UP_FORCE_RESTART";

/// How long a restart waits for the cut-off turn to end before it gives up
/// and queues the steer instead.
const RESTART_WAIT: Duration = Duration::from_secs(20);
/// How long a restart keeps retrying a prompt the connection still calls busy.
const RESTART_SEND_RETRY: Duration = Duration::from_secs(5);

// ------------------------------------------------------------------ views

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub conversation_id: i32,
    pub position: i32,
    pub text: String,
    pub blocks: Vec<PromptInputBlock>,
    pub mode_id: Option<String>,
    pub adopt_send_time_mode: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueView {
    pub conversation_id: i32,
    pub items: Vec<QueueItem>,
    pub held: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteerRecord {
    pub id: String,
    pub conversation_id: i32,
    /// `native` / `restart`.
    pub how: String,
    pub text: String,
    /// `pending` (a restart still cutting the turn off) / `sent` /
    /// `undelivered` (the user stopped first) / `requeued`.
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteerUndelivered {
    pub conversation_id: Option<i32>,
    pub connection_id: String,
    pub steer_id: String,
    pub text: String,
    pub blocks: Vec<PromptInputBlock>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SteerHow {
    Native,
    Restart,
    Queued,
    /// The turn had already ended: the caller sends it as a normal prompt.
    NotRunning,
    /// keh4l build: the turn had already ended, and the message was queued
    /// as the next one (`steer_or_queue`).
    NextMessage,
}

/// keh4l build: how to queue a steer whose turn has already ended
/// (`steer_or_queue`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextMessage {
    #[serde(default)]
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteerResult {
    pub how: SteerHow,
    pub steer_id: Option<String>,
    pub item_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mode_id: Option<String>,
    #[serde(default)]
    adopt_send_time_mode: bool,
}

fn item_view(row: follow_up_queue::Model) -> QueueItem {
    let options: ItemOptions = row
        .options
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();
    QueueItem {
        blocks: serde_json::from_str(&row.blocks).unwrap_or_default(),
        id: row.id,
        conversation_id: row.conversation_id,
        position: row.position,
        text: row.text,
        mode_id: options.mode_id,
        adopt_send_time_mode: options.adopt_send_time_mode,
        created_at: row.created_at,
    }
}

fn steer_view(row: steer_record::Model) -> SteerRecord {
    SteerRecord {
        id: row.id,
        conversation_id: row.conversation_id,
        how: row.how,
        text: row.text,
        status: row.status,
        created_at: row.created_at,
    }
}

/// Whether agents get upstream's `check_user_feedback` pull tool. Never in
/// this build: every agent can be steered (natively or by restart), so the
/// "leave a note the agent may read later" channel and its "实时反馈" switch
/// are gone — the stored setting is ignored.
pub fn pull_feedback_tool(_setting: bool) -> bool {
    false
}

fn acp_err(err: AcpError) -> AppCommandError {
    AppCommandError::invalid_input(err.to_string())
}

// ----------------------------------------------------------------- engine

pub struct Runtime {
    pub db: Arc<AppDatabase>,
    pub manager: Arc<ConnectionManager>,
    pub emitter: EventEmitter,
    pub bus: Arc<InternalEventBus>,
}

pub struct Engine {
    rt: Runtime,
    held: Mutex<HashSet<i32>>,
    /// Serializes the sends of one conversation's queue.
    locks: Mutex<HashMap<i32, Arc<tokio::sync::Mutex<()>>>>,
    /// When the user last pressed stop, per conversation.
    stops: Mutex<HashMap<i32, Instant>>,
    /// When a message was last queued, per conversation.
    queued_at: Mutex<HashMap<i32, Instant>>,
}

static ENGINE: OnceLock<Arc<Engine>> = OnceLock::new();

fn engine() -> Result<Arc<Engine>, AppCommandError> {
    ENGINE
        .get()
        .cloned()
        .ok_or_else(|| AppCommandError::configuration_invalid("follow-up engine not started"))
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Install the engine and return its event loop (spawn it). A second call is
/// a no-op. Subscribes to the bus before returning, so no turn end is missed.
pub fn start(runtime: Runtime) -> futures_util::future::BoxFuture<'static, ()> {
    let mut rx = runtime.bus.subscribe();
    let engine = Arc::new(Engine {
        rt: runtime,
        held: Mutex::new(HashSet::new()),
        locks: Mutex::new(HashMap::new()),
        stops: Mutex::new(HashMap::new()),
        queued_at: Mutex::new(HashMap::new()),
    });
    if ENGINE.set(engine.clone()).is_err() {
        return Box::pin(async {});
    }
    Box::pin(async move {
        use tokio::sync::broadcast::error::RecvError;
        // Whatever was queued when the server went down waits for the user.
        match follow_up_service::conversations_with_items(&engine.rt.db.conn).await {
            Ok(ids) => lock(&engine.held).extend(ids),
            Err(err) => tracing::warn!("[follow-up] loading queued conversations: {err}"),
        }
        loop {
            let envelope = match rx.recv().await {
                Ok(envelope) => envelope,
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            };
            match &envelope.payload {
                AcpEvent::TurnComplete { stop_reason, .. } => {
                    let engine = engine.clone();
                    let connection_id = envelope.connection_id.clone();
                    let stop_reason = stop_reason.clone();
                    tokio::spawn(async move {
                        engine.on_turn_complete(&connection_id, &stop_reason).await;
                    });
                }
                AcpEvent::StatusChanged {
                    status: ConnectionStatus::Disconnected,
                } => {
                    let engine = engine.clone();
                    let connection_id = envelope.connection_id.clone();
                    tokio::spawn(async move {
                        engine.on_disconnected(&connection_id).await;
                    });
                }
                _ => {}
            }
        }
    })
}

impl Engine {
    fn db(&self) -> &sea_orm::DatabaseConnection {
        &self.rt.db.conn
    }

    fn conversation_lock(&self, conversation_id: i32) -> Arc<tokio::sync::Mutex<()>> {
        lock(&self.locks)
            .entry(conversation_id)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    fn is_held(&self, conversation_id: i32) -> bool {
        lock(&self.held).contains(&conversation_id)
    }

    fn set_held(&self, conversation_id: i32, held: bool) -> bool {
        let mut set = lock(&self.held);
        if held {
            set.insert(conversation_id)
        } else {
            set.remove(&conversation_id)
        }
    }

    async fn conversation_of(&self, connection_id: &str) -> Option<i32> {
        let state = self.rt.manager.get_state(connection_id).await?;
        let id = state.read().await.conversation_id;
        id
    }

    async fn turn_in_flight(&self, connection_id: &str) -> Option<bool> {
        let state = self.rt.manager.get_state(connection_id).await?;
        let busy = state.read().await.turn_in_flight;
        Some(busy)
    }

    async fn view(&self, conversation_id: i32) -> Result<QueueView, AppCommandError> {
        let rows = follow_up_service::list(self.db(), conversation_id).await?;
        let held = !rows.is_empty() && self.is_held(conversation_id);
        Ok(QueueView {
            conversation_id,
            items: rows.into_iter().map(item_view).collect(),
            held,
        })
    }

    async fn broadcast_queue(&self, conversation_id: i32) {
        match self.view(conversation_id).await {
            Ok(view) => {
                if view.items.is_empty() {
                    self.set_held(conversation_id, false);
                }
                emit_event(&self.rt.emitter, QUEUE_CHANGED_EVENT, &view);
            }
            Err(err) => tracing::warn!("[follow-up] reading queue {conversation_id}: {err}"),
        }
    }

    fn broadcast_steers(&self, conversation_id: Option<i32>) {
        if let Some(id) = conversation_id {
            emit_event(
                &self.rt.emitter,
                STEERS_CHANGED_EVENT,
                serde_json::json!({ "conversationId": id }),
            );
        }
    }

    async fn folder_of(&self, conversation_id: i32) -> Option<i32> {
        conversation::Entity::find_by_id(conversation_id)
            .one(self.db())
            .await
            .ok()
            .flatten()
            .map(|row| row.folder_id)
    }

    async fn on_turn_complete(&self, connection_id: &str, stop_reason: &str) {
        let Some(conversation_id) = self.conversation_of(connection_id).await else {
            return;
        };
        let queued_after_stop = {
            let stops = lock(&self.stops);
            let queued = lock(&self.queued_at);
            match (stops.get(&conversation_id), queued.get(&conversation_id)) {
                (Some(stop), Some(queued)) => queued > stop,
                _ => false,
            }
        };
        let restart = restart::turn_end_is_restart(connection_id, stop_reason);
        match route::on_turn_end(stop_reason, restart, queued_after_stop) {
            TurnEndAction::Ignore => {}
            TurnEndAction::Flush => {
                if queued_after_stop {
                    self.set_held(conversation_id, false);
                }
                if let Err(err) = self.flush(conversation_id, connection_id).await {
                    tracing::warn!("[follow-up] sending the next queued message: {err}");
                }
            }
            TurnEndAction::Hold => {
                let has_items = follow_up_service::list(self.db(), conversation_id)
                    .await
                    .map(|rows| !rows.is_empty())
                    .unwrap_or(false);
                if has_items && self.set_held(conversation_id, true) {
                    self.broadcast_queue(conversation_id).await;
                }
            }
        }
    }

    async fn on_disconnected(&self, connection_id: &str) {
        native::forget(connection_id);
        if let Some(pending) = restart::stop(connection_id) {
            self.undelivered(connection_id, pending).await;
        }
    }

    /// Send the head of the queue if the queue is not held and the connection
    /// is idle. Returns whether a message went out.
    async fn flush(
        &self,
        conversation_id: i32,
        connection_id: &str,
    ) -> Result<bool, AppCommandError> {
        let guard = self.conversation_lock(conversation_id);
        let _guard = guard.lock().await;
        if self.is_held(conversation_id) {
            return Ok(false);
        }
        let Some(head) = follow_up_service::list(self.db(), conversation_id)
            .await?
            .into_iter()
            .next()
        else {
            return Ok(false);
        };
        self.send_item_locked(conversation_id, connection_id, head)
            .await
    }

    /// Send one queued item as a new prompt. The caller holds the
    /// conversation lock.
    async fn send_item_locked(
        &self,
        conversation_id: i32,
        connection_id: &str,
        item: follow_up_queue::Model,
    ) -> Result<bool, AppCommandError> {
        if self.turn_in_flight(connection_id).await != Some(false) {
            return Ok(false);
        }
        let view = item_view(item.clone());
        if let (Some(mode_id), false) = (view.mode_id.clone(), view.adopt_send_time_mode) {
            let current = match self.rt.manager.get_state(connection_id).await {
                Some(state) => state.read().await.current_mode.clone(),
                None => None,
            };
            if current.as_deref() != Some(mode_id.as_str()) {
                if let Err(err) = self.rt.manager.set_mode(connection_id, mode_id).await {
                    tracing::warn!("[follow-up] setting the queued message's mode: {err}");
                }
            }
        }
        let folder_id = self.folder_of(conversation_id).await;
        let sent = self
            .rt
            .manager
            .send_prompt_linked_with_message_id(
                &self.rt.db,
                connection_id,
                view.blocks,
                folder_id,
                Some(conversation_id),
                None,
                Some(item.id.clone()),
            )
            .await;
        match sent {
            Ok(_) => {
                follow_up_service::remove(self.db(), &item.id).await?;
                self.broadcast_queue(conversation_id).await;
                Ok(true)
            }
            Err(AcpError::TurnInProgress) => Ok(false),
            Err(err) => {
                // Keep it, and keep the rest from going out behind it.
                if self.set_held(conversation_id, true) {
                    self.broadcast_queue(conversation_id).await;
                }
                Err(acp_err(err))
            }
        }
    }

    async fn insert(
        &self,
        conversation_id: i32,
        text: String,
        blocks: Vec<PromptInputBlock>,
        options: ItemOptions,
        index: Option<usize>,
    ) -> Result<String, AppCommandError> {
        self.insert_with_id(conversation_id, text, blocks, options, index, None)
            .await
    }

    /// `insert` under `id` when given (keh4l build: an id the client chose).
    async fn insert_with_id(
        &self,
        conversation_id: i32,
        text: String,
        blocks: Vec<PromptInputBlock>,
        options: ItemOptions,
        index: Option<usize>,
        id: Option<String>,
    ) -> Result<String, AppCommandError> {
        let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let options = (options.mode_id.is_some() || options.adopt_send_time_mode)
            .then(|| serde_json::to_string(&options).unwrap_or_default());
        follow_up_service::insert(
            self.db(),
            NewItem {
                id: id.clone(),
                conversation_id,
                text,
                blocks: serde_json::to_string(&blocks).unwrap_or_else(|_| "[]".into()),
                options,
            },
            index,
        )
        .await?;
        Ok(id)
    }

    async fn record_steer(
        &self,
        id: &str,
        conversation_id: Option<i32>,
        how: &str,
        text: &str,
        status: &str,
    ) {
        let Some(conversation_id) = conversation_id else {
            return;
        };
        if let Err(err) =
            follow_up_service::insert_steer(self.db(), id, conversation_id, how, text, status).await
        {
            tracing::warn!("[follow-up] recording a steer: {err}");
        }
        self.broadcast_steers(Some(conversation_id));
    }

    async fn set_steer_status(&self, id: &str, conversation_id: Option<i32>, status: &str) {
        if let Err(err) = follow_up_service::set_steer_status(self.db(), id, status).await {
            tracing::warn!("[follow-up] updating a steer: {err}");
        }
        self.broadcast_steers(conversation_id);
    }

    async fn undelivered(&self, connection_id: &str, pending: restart::PendingRestart) {
        self.set_steer_status(&pending.steer_id, pending.conversation_id, "undelivered")
            .await;
        emit_event(
            &self.rt.emitter,
            STEER_UNDELIVERED_EVENT,
            &SteerUndelivered {
                conversation_id: pending.conversation_id,
                connection_id: connection_id.to_string(),
                steer_id: pending.steer_id,
                text: pending.text,
                blocks: pending.blocks,
            },
        );
    }

    /// Cut the running turn off and send `steer_id`'s message as the next
    /// prompt (see [`restart`]).
    async fn run_restart(self: Arc<Self>, connection_id: String) {
        let cmd_tx = {
            let connections = self.rt.manager.connections.lock().await;
            connections.get(&connection_id).map(|c| c.cmd_tx.clone())
        };
        let cancelled = match cmd_tx {
            Some(tx) => tx.send(ConnectionCommand::Cancel).await.is_ok(),
            None => false,
        };
        let started = Instant::now();
        let mut ended = false;
        if cancelled {
            while started.elapsed() < RESTART_WAIT {
                match self.turn_in_flight(&connection_id).await {
                    Some(true) => tokio::time::sleep(Duration::from_millis(50)).await,
                    Some(false) => {
                        ended = true;
                        break;
                    }
                    None => break,
                }
            }
        }
        // Gone when the user stopped in the meantime (they were told).
        let Some(pending) = restart::take_for_send(&connection_id) else {
            return;
        };
        if !ended {
            self.requeue_steer(&connection_id, pending).await;
            restart::finish(&connection_id);
            return;
        }
        let folder_id = match pending.conversation_id {
            Some(id) => self.folder_of(id).await,
            None => None,
        };
        let deadline = Instant::now() + RESTART_SEND_RETRY;
        let outcome = loop {
            let sent = self
                .rt
                .manager
                .send_prompt_linked_with_message_id(
                    &self.rt.db,
                    &connection_id,
                    pending.blocks.clone(),
                    folder_id,
                    pending.conversation_id,
                    None,
                    Some(pending.steer_id.clone()),
                )
                .await;
            match sent {
                Err(AcpError::TurnInProgress) if Instant::now() < deadline => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                other => break other,
            }
        };
        match outcome {
            Ok(_) => {
                self.set_steer_status(&pending.steer_id, pending.conversation_id, "sent")
                    .await;
            }
            Err(err) => {
                tracing::warn!("[follow-up] restart prompt failed: {err}");
                self.requeue_steer(&connection_id, pending).await;
            }
        }
        restart::finish(&connection_id);
    }

    /// A steer that could not go into its turn waits at the front of the queue.
    async fn requeue_steer(&self, connection_id: &str, pending: restart::PendingRestart) {
        let Some(conversation_id) = pending.conversation_id else {
            self.undelivered(connection_id, pending).await;
            return;
        };
        match self
            .insert(
                conversation_id,
                pending.text.clone(),
                pending.blocks.clone(),
                ItemOptions {
                    mode_id: None,
                    adopt_send_time_mode: true,
                },
                Some(0),
            )
            .await
        {
            Ok(_) => {
                self.set_steer_status(&pending.steer_id, Some(conversation_id), "requeued")
                    .await;
                self.broadcast_queue(conversation_id).await;
                let _ = self.flush(conversation_id, connection_id).await;
            }
            Err(err) => {
                tracing::warn!("[follow-up] requeueing a steer: {err}");
                self.undelivered(connection_id, pending).await;
            }
        }
    }

    async fn steer_inner(
        self: &Arc<Self>,
        connection_id: &str,
        conversation_id: Option<i32>,
        text: String,
        blocks: Vec<PromptInputBlock>,
    ) -> Result<SteerResult, AppCommandError> {
        let state = self
            .rt
            .manager
            .get_state(connection_id)
            .await
            .ok_or_else(|| AppCommandError::not_found("connection not found"))?;
        let (running, compacting, native, agent_type, bound) = {
            let s = state.read().await;
            let compacting = s.active_tool_calls.values().any(|call| {
                matches!(
                    call.status,
                    crate::acp::session_state::ToolCallStatus::Pending
                        | crate::acp::session_state::ToolCallStatus::InProgress
                ) && route::is_compaction_meta(call.meta.as_ref())
            });
            (
                s.turn_in_flight,
                compacting,
                s.native_steering_available,
                s.agent_type,
                s.conversation_id,
            )
        };
        let conversation_id = conversation_id.or(bound);
        // Verification switch: steer every agent by restart, so the restart
        // path can be exercised against an agent that steers natively.
        let native = native && std::env::var_os(FORCE_RESTART_ENV).is_none();
        let mut route = route::route_steer(SteerContext {
            running,
            compacting,
            native,
            native_accepts: native::accepts(connection_id, &blocks),
            agent_type,
        });
        if route == SteerRoute::Native {
            match self
                .rt
                .manager
                .submit_feedback(connection_id, text.clone(), Some(blocks.clone()))
                .await
            {
                Ok(item) => {
                    self.record_steer(&item.id, conversation_id, "native", &text, "sent")
                        .await;
                    return Ok(SteerResult {
                        how: SteerHow::Native,
                        steer_id: Some(item.id),
                        item_id: None,
                    });
                }
                Err(AcpError::NoActiveTurn) => {
                    return Ok(SteerResult {
                        how: SteerHow::NotRunning,
                        steer_id: None,
                        item_id: None,
                    })
                }
                Err(err) => {
                    tracing::warn!("[follow-up] native steer failed, falling back: {err}");
                    // A fork wire that answered wrongly is not tried again on
                    // this connection.
                    if native::wire(connection_id).is_some() {
                        native::forget(connection_id);
                        state.write().await.native_steering_available = false;
                    }
                    route = if route::restart_allowed(agent_type) {
                        SteerRoute::Restart
                    } else {
                        SteerRoute::Queue
                    };
                }
            }
        }
        match route {
            SteerRoute::NotRunning => Ok(SteerResult {
                how: SteerHow::NotRunning,
                steer_id: None,
                item_id: None,
            }),
            SteerRoute::Restart => {
                let steer_id = uuid::Uuid::new_v4().to_string();
                let pending = restart::PendingRestart {
                    steer_id: steer_id.clone(),
                    conversation_id,
                    text: text.clone(),
                    blocks: blocks.clone(),
                };
                match restart::begin(connection_id, pending) {
                    restart::Begin::Started => {
                        self.record_steer(&steer_id, conversation_id, "restart", &text, "pending")
                            .await;
                        let engine = self.clone();
                        let conn = connection_id.to_string();
                        tokio::spawn(async move { engine.run_restart(conn).await });
                        Ok(SteerResult {
                            how: SteerHow::Restart,
                            steer_id: Some(steer_id),
                            item_id: None,
                        })
                    }
                    restart::Begin::Joined => Ok(SteerResult {
                        how: SteerHow::Restart,
                        steer_id: restart::pending(connection_id).map(|p| p.steer_id),
                        item_id: None,
                    }),
                    // The previous restart's prompt is about to start a turn;
                    // this one waits for it rather than cutting it off again.
                    restart::Begin::Busy => {
                        self.queue_steer(conversation_id, connection_id, text, blocks)
                            .await
                    }
                }
            }
            SteerRoute::Queue | SteerRoute::Native => {
                self.queue_steer(conversation_id, connection_id, text, blocks)
                    .await
            }
        }
    }

    async fn steer_or_queue_inner(
        self: &Arc<Self>,
        connection_id: &str,
        conversation_id: Option<i32>,
        text: String,
        blocks: Vec<PromptInputBlock>,
        next: NextMessage,
    ) -> Result<SteerResult, AppCommandError> {
        let result = self
            .steer_inner(connection_id, conversation_id, text.clone(), blocks.clone())
            .await?;
        if result.how != SteerHow::NotRunning {
            return Ok(result);
        }
        let bound = match self.rt.manager.get_state(connection_id).await {
            Some(state) => state.read().await.conversation_id,
            None => None,
        };
        let Some(conversation_id) = conversation_id.or(bound) else {
            return Ok(result);
        };
        let item_id = self
            .enqueue_inner(
                conversation_id,
                Some(connection_id),
                text,
                blocks,
                ItemOptions {
                    mode_id: next.mode_id,
                    adopt_send_time_mode: false,
                },
            )
            .await?;
        Ok(SteerResult {
            how: SteerHow::NextMessage,
            steer_id: None,
            item_id: Some(item_id),
        })
    }

    async fn queue_steer(
        &self,
        conversation_id: Option<i32>,
        connection_id: &str,
        text: String,
        blocks: Vec<PromptInputBlock>,
    ) -> Result<SteerResult, AppCommandError> {
        let conversation_id = conversation_id
            .ok_or_else(|| AppCommandError::invalid_input("no conversation to queue for"))?;
        let item_id = self
            .enqueue_inner(
                conversation_id,
                Some(connection_id),
                text,
                blocks,
                ItemOptions {
                    mode_id: None,
                    adopt_send_time_mode: true,
                },
            )
            .await?;
        Ok(SteerResult {
            how: SteerHow::Queued,
            steer_id: None,
            item_id: Some(item_id),
        })
    }

    async fn enqueue_inner(
        &self,
        conversation_id: i32,
        connection_id: Option<&str>,
        text: String,
        blocks: Vec<PromptInputBlock>,
        options: ItemOptions,
    ) -> Result<String, AppCommandError> {
        self.enqueue_inner_as(conversation_id, connection_id, text, blocks, options, None)
            .await
    }

    /// `enqueue_inner`, keh4l build: under the id the client chose (a UUID),
    /// so it can remove or edit the item before the broadcast that confirms
    /// it; the same id again is the same item, not a second one.
    async fn enqueue_inner_as(
        &self,
        conversation_id: i32,
        connection_id: Option<&str>,
        text: String,
        blocks: Vec<PromptInputBlock>,
        options: ItemOptions,
        client_id: Option<String>,
    ) -> Result<String, AppCommandError> {
        let client_id = client_id.filter(|id| uuid::Uuid::parse_str(id).is_ok());
        if let Some(id) = &client_id {
            if follow_up_service::get(self.db(), id).await?.is_some() {
                return Ok(id.clone());
            }
        }
        let id = self
            .insert_with_id(conversation_id, text, blocks, options, None, client_id)
            .await?;
        lock(&self.queued_at).insert(conversation_id, Instant::now());
        // A new message lets a held queue go.
        self.set_held(conversation_id, false);
        self.broadcast_queue(conversation_id).await;
        if let Some(connection_id) = connection_id {
            if let Err(err) = self.flush(conversation_id, connection_id).await {
                tracing::warn!("[follow-up] sending after enqueue: {err}");
            }
        }
        Ok(id)
    }
}

// ------------------------------------------------------------- public API

/// Steer `text`/`blocks` into the turn running on `connection_id`.
pub async fn steer(
    connection_id: &str,
    conversation_id: Option<i32>,
    text: String,
    blocks: Vec<PromptInputBlock>,
) -> Result<SteerResult, AppCommandError> {
    engine()?
        .steer_inner(connection_id, conversation_id, text, blocks)
        .await
}

/// keh4l build: [`steer`], and when the turn has already ended, queue the
/// message as the next one — what the caller would otherwise do next, one
/// round trip later.
pub async fn steer_or_queue(
    connection_id: &str,
    conversation_id: Option<i32>,
    text: String,
    blocks: Vec<PromptInputBlock>,
    next: NextMessage,
) -> Result<SteerResult, AppCommandError> {
    engine()?
        .steer_or_queue_inner(connection_id, conversation_id, text, blocks, next)
        .await
}

/// Queue a message for the conversation. With a connection, it goes out at
/// once when that connection is idle. Returns the item id.
pub async fn enqueue(
    conversation_id: i32,
    connection_id: Option<&str>,
    text: String,
    blocks: Vec<PromptInputBlock>,
    mode_id: Option<String>,
    adopt_send_time_mode: bool,
) -> Result<String, AppCommandError> {
    engine()?
        .enqueue_inner(
            conversation_id,
            connection_id,
            text,
            blocks,
            ItemOptions {
                mode_id,
                adopt_send_time_mode,
            },
        )
        .await
}

/// [`enqueue`] under the id the client chose (keh4l build; see
/// `enqueue_inner_as`).
pub async fn enqueue_as(
    conversation_id: i32,
    connection_id: Option<&str>,
    text: String,
    blocks: Vec<PromptInputBlock>,
    mode_id: Option<String>,
    adopt_send_time_mode: bool,
    client_id: Option<String>,
) -> Result<String, AppCommandError> {
    engine()?
        .enqueue_inner_as(
            conversation_id,
            connection_id,
            text,
            blocks,
            ItemOptions {
                mode_id,
                adopt_send_time_mode,
            },
            client_id,
        )
        .await
}

pub async fn list(conversation_id: i32) -> Result<QueueView, AppCommandError> {
    engine()?.view(conversation_id).await
}

pub async fn update(
    item_id: &str,
    text: String,
    blocks: Vec<PromptInputBlock>,
) -> Result<(), AppCommandError> {
    let engine = engine()?;
    let row = follow_up_service::update_content(
        engine.db(),
        item_id,
        text,
        serde_json::to_string(&blocks).unwrap_or_else(|_| "[]".into()),
        None,
    )
    .await?
    .ok_or_else(|| AppCommandError::not_found("queued message not found"))?;
    engine.broadcast_queue(row.conversation_id).await;
    Ok(())
}

pub async fn remove(item_id: &str) -> Result<(), AppCommandError> {
    let engine = engine()?;
    if let Some(row) = follow_up_service::remove(engine.db(), item_id).await? {
        engine.broadcast_queue(row.conversation_id).await;
    }
    Ok(())
}

pub async fn reorder(conversation_id: i32, ids: Vec<String>) -> Result<(), AppCommandError> {
    let engine = engine()?;
    follow_up_service::reorder(engine.db(), conversation_id, &ids).await?;
    engine.broadcast_queue(conversation_id).await;
    Ok(())
}

/// Let a held queue go and send its head if the connection is idle.
pub async fn resume(
    conversation_id: i32,
    connection_id: Option<&str>,
) -> Result<(), AppCommandError> {
    let engine = engine()?;
    engine.set_held(conversation_id, false);
    engine.broadcast_queue(conversation_id).await;
    if let Some(connection_id) = connection_id {
        engine.flush(conversation_id, connection_id).await?;
    }
    Ok(())
}

/// Send the head if the queue is free and the connection idle — for a
/// connection that just became ready with messages waiting. Never right after
/// a turn that did not end normally: that turn end holds the queue, and a
/// client that sees the turn end first must not beat the hold to it.
pub async fn kick(conversation_id: i32, connection_id: &str) -> Result<bool, AppCommandError> {
    let engine = engine()?;
    if let Some(state) = engine.rt.manager.get_state(connection_id).await {
        if state.read().await.last_turn_ended_abnormally {
            return Ok(false);
        }
    }
    engine.flush(conversation_id, connection_id).await
}

/// "Send now" on a queued message: into the running turn when there is one,
/// else as a new turn (a held queue stays held for the rest).
pub async fn send_now(item_id: &str, connection_id: &str) -> Result<SteerResult, AppCommandError> {
    let engine = engine()?;
    let row = follow_up_service::get(engine.db(), item_id)
        .await?
        .ok_or_else(|| AppCommandError::not_found("queued message not found"))?;
    let conversation_id = row.conversation_id;
    let running = engine.turn_in_flight(connection_id).await.unwrap_or(false);
    if running {
        let view = item_view(row.clone());
        let result = engine
            .steer_inner(connection_id, Some(conversation_id), view.text, view.blocks)
            .await?;
        match result.how {
            SteerHow::Native | SteerHow::Restart => {
                follow_up_service::remove(engine.db(), item_id).await?;
                engine.broadcast_queue(conversation_id).await;
                return Ok(result);
            }
            SteerHow::Queued => {
                // It went back into the queue as a new item; drop the copy.
                if let Some(new_id) = result.item_id.as_deref() {
                    follow_up_service::remove(engine.db(), new_id).await?;
                    engine.broadcast_queue(conversation_id).await;
                }
                return Ok(SteerResult {
                    how: SteerHow::Queued,
                    steer_id: None,
                    item_id: Some(item_id.to_string()),
                });
            }
            // `steer_inner` never queues on its own (`steer_or_queue` does).
            SteerHow::NotRunning | SteerHow::NextMessage => {}
        }
    }
    let guard = engine.conversation_lock(conversation_id);
    let _guard = guard.lock().await;
    let sent = engine
        .send_item_locked(conversation_id, connection_id, row)
        .await?;
    Ok(SteerResult {
        how: if sent {
            SteerHow::NotRunning
        } else {
            SteerHow::Queued
        },
        steer_id: None,
        item_id: Some(item_id.to_string()),
    })
}

pub async fn steers(conversation_id: i32) -> Result<Vec<SteerRecord>, AppCommandError> {
    let engine = engine()?;
    Ok(follow_up_service::steers_of(engine.db(), conversation_id)
        .await?
        .into_iter()
        .map(steer_view)
        .collect())
}

/// The user stopped `connection_id`'s turn (`ConnectionManager::cancel`). A
/// steer still waiting for a restart is not sent — the user is told — and the
/// stop is remembered, so a message queued after it is not held.
pub async fn on_user_cancel(connection_id: &str) {
    let Some(engine) = ENGINE.get().cloned() else {
        return;
    };
    if let Some(conversation_id) = engine.conversation_of(connection_id).await {
        lock(&engine.stops).insert(conversation_id, Instant::now());
    }
    if let Some(pending) = restart::stop(connection_id) {
        engine.undelivered(connection_id, pending).await;
    }
}

#[cfg(test)]
mod tests;
