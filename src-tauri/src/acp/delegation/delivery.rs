//! keh4l build: hand finished delegations back to the parent agent instead of
//! waiting to be polled.
//!
//! When a delegated task the parent session launched reaches a terminal state,
//! its result is queued for the parent CONVERSATION (not the connection, which
//! a reconnect replaces) and delivered the first way that works:
//!
//! 1. **Attached** — the parent is sent any prompt (the user's, a queued one,
//!    an automation's): the queued results ride along as an internal suffix.
//! 2. **Steer** — the parent is running a turn on an agent with native
//!    steering and nothing is waiting on the user: the results are injected
//!    into that turn.
//! 3. **Wake** — the parent is idle: after [`COALESCE`] (which merges siblings
//!    that finish together and lets a message the user queued go first, as 1)
//!    Codeg starts a turn whose prompt is the results alone.
//!
//! Not delivered, or not by waking:
//!
//! - A task the parent agent already learned about by itself
//!   (`get_delegation_status`, `cancel_delegation`, `resume_delegation`) is
//!   taken off the queue: pulling wins, nothing arrives twice.
//! - A task the user canceled rides along with the next prompt but never
//!   wakes the parent.
//! - After the parent's turn ends any other way than `end_turn` (the user
//!   stopped it, or it failed), and after [`WAKE_CAP`] wakes in a row with no
//!   prompt from anyone else, waking pauses until the next prompt; queued
//!   results then ride along with it.
//! - A parent session launched while the switch was off is never pushed to:
//!   its tool descriptions say to poll, so it polls.
//!
//! The parent's turn failing no longer cancels its delegations (it used to
//! for any non-`end_turn` end); only the user stopping it does —
//! [`turn_end_cancels_children`].

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, OnceLock, Weak};
use std::time::Duration;

use async_trait::async_trait;
use sea_orm::DatabaseConnection;

use super::broker::DelegationBroker;
use super::notice::{self, NoticeTask, RenderedNotice};
use crate::acp::error::AcpError;
use crate::acp::internal_bus::InternalEventBus;
use crate::acp::manager::ConnectionManager;
use crate::acp::types::{AcpEvent, ConnectionStatus, PromptInputBlock};
use crate::app_error::AppCommandError;
use crate::db::service::app_metadata_service;
use crate::db::AppDatabase;
use crate::models::delegation_results::DelegationResultsMode;
use crate::web::event_bridge::{emit_event, emit_with_state, EventEmitter};

/// How long a finished result waits before Codeg wakes an idle parent.
pub const COALESCE: Duration = Duration::from_secs(2);
/// Wakes in a row, with no prompt from anyone else between them, before
/// waking pauses.
pub const WAKE_CAP: u32 = 20;
/// Parent conversations tracked at most; idle entries go first.
const MAX_SLOTS: usize = 4096;

// ── The switch ───────────────────────────────────────────────────────────────

const PUSH_KEY: &str = "delegation.push_results";

/// Broadcast after the switch changes, carrying [`DelegationPushSettings`].
pub const SETTINGS_CHANGED_EVENT: &str = "delegation-push-settings://changed";

static PUSH_ENABLED: AtomicBool = AtomicBool::new(true);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DelegationPushSettings {
    pub enabled: bool,
}

/// Whether a session launched now gets its results pushed.
pub fn push_enabled() -> bool {
    PUSH_ENABLED.load(Ordering::Relaxed)
}

/// Read the stored switch. Anything but a stored `"false"` leaves it on.
pub async fn apply_persisted_settings(conn: &DatabaseConnection) {
    let enabled = match app_metadata_service::get_value(conn, PUSH_KEY).await {
        Ok(Some(raw)) => raw.trim() != "false",
        Ok(None) => true,
        Err(e) => {
            tracing::warn!("[delegation][push] reading the switch failed ({e}); keeping it on");
            true
        }
    };
    PUSH_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn get_settings() -> DelegationPushSettings {
    DelegationPushSettings {
        enabled: push_enabled(),
    }
}

/// Store the switch, apply it to sessions launched from now on, and tell
/// every client.
pub async fn set_settings_core(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    settings: DelegationPushSettings,
) -> Result<DelegationPushSettings, AppCommandError> {
    app_metadata_service::upsert_value(conn, PUSH_KEY, &settings.enabled.to_string()).await?;
    PUSH_ENABLED.store(settings.enabled, Ordering::Relaxed);
    emit_event(emitter, SETTINGS_CHANGED_EVENT, settings);
    Ok(settings)
}

// ── Which sessions were promised a push ──────────────────────────────────────

static LAUNCHED_WITH_PUSH: LazyLock<std::sync::Mutex<HashSet<String>>> =
    LazyLock::new(Default::default);

/// Record whether the companion of `connection_id` was launched with the
/// `push` feature — what its tool descriptions told the agent.
pub fn note_companion_launch(connection_id: &str, push: bool) {
    let mut set = LAUNCHED_WITH_PUSH.lock().expect("push launch set poisoned");
    if push {
        set.insert(connection_id.to_string());
    } else {
        set.remove(connection_id);
    }
}

pub fn launched_with_push(connection_id: &str) -> bool {
    LAUNCHED_WITH_PUSH
        .lock()
        .expect("push launch set poisoned")
        .contains(connection_id)
}

fn forget_connection(connection_id: &str) {
    LAUNCHED_WITH_PUSH
        .lock()
        .expect("push launch set poisoned")
        .remove(connection_id);
}

/// Whether a parent turn that ended with `stop_reason` cancels the
/// delegations it owns. Only the user stopping it does: a turn that failed
/// (rate limit, refusal, max tokens…) leaves them running, and their results
/// reach the parent with the next prompt.
pub fn turn_end_cancels_children(stop_reason: &str) -> bool {
    stop_reason == "cancelled"
}

// ── What the broker reports ──────────────────────────────────────────────────

/// Why a task stopped, as far as delivery cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalCause {
    /// It ended its turn — cleanly or with an error of its own.
    Finished,
    /// Its connection died under it.
    ChildFailed,
    /// The user canceled it (stopping the parent, or the child itself).
    UserCanceled,
}

impl TerminalCause {
    fn wakes(self) -> bool {
        !matches!(self, TerminalCause::UserCanceled)
    }
}

#[derive(Debug, Clone)]
pub struct TerminalEvent {
    pub parent_connection_id: String,
    pub parent_conversation_id: i32,
    pub task: NoticeTask,
    pub cause: TerminalCause,
}

/// What the broker calls. Both methods are synchronous and cheap: the broker
/// calls `on_terminal` with its pending lock held, so that no status query
/// can hand the parent a result before it is queued here (which would then
/// deliver it twice).
pub trait DeliverySink: Send + Sync {
    fn on_terminal(&self, event: TerminalEvent);
    /// The parent agent received these tasks' terminal results itself.
    fn on_consumed(&self, task_ids: &[String]);
}

// ── The parent side, behind a trait for tests ────────────────────────────────

#[derive(Debug, Clone)]
pub struct ParentSnapshot {
    pub connection_id: String,
    pub turn_in_flight: bool,
    /// Native steering, and nothing open that a steer would disturb.
    pub can_steer: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SteerResult {
    Injected,
    NotNow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeResult {
    Sent,
    /// A turn started first.
    Busy,
    Failed,
}

#[async_trait]
pub trait ParentDriver: Send + Sync {
    /// The live connection of the conversation, if any.
    async fn parent(&self, conversation_id: i32) -> Option<ParentSnapshot>;
    async fn conversation_of(&self, connection_id: &str) -> Option<i32>;
    /// Task ids of the conversation's delegations still running.
    async fn still_running(&self, conversation_id: i32) -> Vec<String>;
    async fn steer(&self, connection_id: &str, notice: &RenderedNotice) -> SteerResult;
    async fn wake(
        &self,
        connection_id: &str,
        conversation_id: i32,
        notice: &RenderedNotice,
    ) -> WakeResult;
    /// Waking the conversation was paused (`held`) or resumed.
    async fn held_changed(&self, conversation_id: i32, held: bool);
}

// ── The hub ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Queued {
    task: NoticeTask,
    wakes: bool,
}

#[derive(Debug, Default)]
struct ParentSlot {
    queue: Vec<Queued>,
    flush_scheduled: bool,
    paused: bool,
    wakes_in_a_row: u32,
}

impl ParentSlot {
    fn wants_wake(&self) -> bool {
        !self.paused && self.queue.iter().any(|q| q.wakes)
    }

    fn idle(&self) -> bool {
        self.queue.is_empty() && !self.flush_scheduled && !self.paused && self.wakes_in_a_row == 0
    }
}

/// A batch taken off a parent's queue, rendered, and not yet confirmed sent.
pub struct TakenBatch {
    conversation_id: i32,
    items: Vec<Queued>,
    pub notice: RenderedNotice,
}

pub struct DeliveryHub {
    me: Weak<DeliveryHub>,
    driver: Arc<dyn ParentDriver>,
    slots: std::sync::Mutex<HashMap<i32, ParentSlot>>,
    coalesce: Duration,
    wake_cap: u32,
}

impl DeliveryHub {
    pub fn new(driver: Arc<dyn ParentDriver>, coalesce: Duration, wake_cap: u32) -> Arc<Self> {
        Arc::new_cyclic(|me| Self {
            me: me.clone(),
            driver,
            slots: Default::default(),
            coalesce,
            wake_cap,
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<i32, ParentSlot>> {
        self.slots.lock().expect("delivery slots poisoned")
    }

    fn trim(slots: &mut HashMap<i32, ParentSlot>) {
        if slots.len() > MAX_SLOTS {
            slots.retain(|_, slot| !slot.idle());
        }
    }

    /// Tell the conversation's clients whether waking is paused.
    fn notify_held(&self, conversation_id: i32, held: bool) {
        let Some(hub) = self.me.upgrade() else {
            return;
        };
        if tokio::runtime::Handle::try_current().is_err() {
            return;
        }
        tokio::spawn(async move {
            hub.driver.held_changed(conversation_id, held).await;
        });
    }

    /// Wake the parent after the coalescing window, unless already due.
    fn schedule(&self, conversation_id: i32) {
        {
            let mut slots = self.lock();
            let Some(slot) = slots.get_mut(&conversation_id) else {
                return;
            };
            if slot.flush_scheduled || !slot.wants_wake() {
                return;
            }
            slot.flush_scheduled = true;
        }
        let Some(hub) = self.me.upgrade() else {
            return;
        };
        let delay = self.coalesce;
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            hub.flush(conversation_id).await;
        });
    }

    /// Take everything queued for `conversation_id` and render it, with what
    /// each worktree task changed there.
    async fn take(
        &self,
        conversation_id: i32,
        mode: DelegationResultsMode,
        still_running: Vec<String>,
    ) -> Option<TakenBatch> {
        let items = {
            let mut slots = self.lock();
            let slot = slots.get_mut(&conversation_id)?;
            if slot.queue.is_empty() {
                return None;
            }
            std::mem::take(&mut slot.queue)
        };
        let mut tasks: Vec<NoticeTask> = items.iter().map(|q| q.task.clone()).collect();
        for task in tasks.iter_mut() {
            if let Some(wt) = task.worktree.as_mut() {
                if wt.changes.is_none() {
                    wt.changes =
                        super::worktree::changes(std::path::Path::new(&wt.path), &wt.base_sha)
                            .await;
                }
            }
        }
        let notice = notice::render(mode, tasks, still_running)?;
        Some(TakenBatch {
            conversation_id,
            items,
            notice,
        })
    }

    /// Put a batch that did not go out back at the front of its queue.
    pub fn restore(&self, batch: TakenBatch) {
        let mut slots = self.lock();
        let slot = slots.entry(batch.conversation_id).or_default();
        let mut items = batch.items;
        items.append(&mut slot.queue);
        slot.queue = items;
    }

    async fn flush(&self, conversation_id: i32) {
        {
            let mut slots = self.lock();
            let Some(slot) = slots.get_mut(&conversation_id) else {
                return;
            };
            slot.flush_scheduled = false;
            if !slot.wants_wake() {
                return;
            }
        }
        let Some(parent) = self.driver.parent(conversation_id).await else {
            // No live session: the results wait for the next prompt.
            return;
        };
        if !launched_with_push(&parent.connection_id) {
            return;
        }
        let still_running = self.driver.still_running(conversation_id).await;
        if parent.turn_in_flight {
            if !parent.can_steer {
                // Delivered when this turn ends (`on_turn_complete`).
                return;
            }
            let Some(batch) = self
                .take(conversation_id, DelegationResultsMode::Steer, still_running)
                .await
            else {
                return;
            };
            match self
                .driver
                .steer(&parent.connection_id, &batch.notice)
                .await
            {
                SteerResult::Injected => {}
                SteerResult::NotNow => {
                    // The turn ended under us, or something opened: try again
                    // once the window has passed, whatever state it is then.
                    self.restore(batch);
                    self.schedule(conversation_id);
                }
            }
            return;
        }
        {
            let mut slots = self.lock();
            let Some(slot) = slots.get_mut(&conversation_id) else {
                return;
            };
            if slot.wakes_in_a_row >= self.wake_cap {
                tracing::info!(
                    "[delegation][push] conversation {conversation_id} was woken {} times in a \
                     row; holding further results for the next prompt",
                    slot.wakes_in_a_row
                );
                slot.paused = true;
                drop(slots);
                self.notify_held(conversation_id, true);
                return;
            }
        }
        let Some(batch) = self
            .take(conversation_id, DelegationResultsMode::Wake, still_running)
            .await
        else {
            return;
        };
        match self
            .driver
            .wake(&parent.connection_id, conversation_id, &batch.notice)
            .await
        {
            WakeResult::Sent => {
                let mut slots = self.lock();
                slots.entry(conversation_id).or_default().wakes_in_a_row += 1;
            }
            WakeResult::Busy => {
                self.restore(batch);
                self.schedule(conversation_id);
            }
            WakeResult::Failed => {
                // Left for the next prompt rather than retried in a loop.
                self.restore(batch);
            }
        }
    }

    /// A turn of `connection_id` ended.
    pub async fn on_turn_complete(&self, connection_id: &str, stop_reason: &str) {
        let Some(conversation_id) = self.driver.conversation_of(connection_id).await else {
            return;
        };
        if stop_reason == "end_turn" {
            self.schedule(conversation_id);
            return;
        }
        if !launched_with_push(connection_id) {
            return;
        }
        let newly = {
            let mut slots = self.lock();
            let slot = slots.entry(conversation_id).or_default();
            let newly = !slot.paused;
            slot.paused = true;
            Self::trim(&mut slots);
            newly
        };
        if newly {
            self.notify_held(conversation_id, true);
        }
    }

    /// Take what is queued for a prompt about to be sent to the conversation.
    /// A prompt also lifts a pause and restarts the wake count.
    pub async fn take_for_prompt(&self, conversation_id: i32) -> Option<TakenBatch> {
        let (has_queue, was_paused) = {
            let mut slots = self.lock();
            let slot = slots.get_mut(&conversation_id)?;
            let was_paused = slot.paused;
            slot.paused = false;
            slot.wakes_in_a_row = 0;
            if slot.idle() {
                slots.remove(&conversation_id);
            }
            let has_queue = slots
                .get(&conversation_id)
                .is_some_and(|slot| !slot.queue.is_empty());
            (has_queue, was_paused)
        };
        if was_paused {
            self.notify_held(conversation_id, false);
        }
        if !has_queue {
            return None;
        }
        let still_running = self.driver.still_running(conversation_id).await;
        self.take(
            conversation_id,
            DelegationResultsMode::Attached,
            still_running,
        )
        .await
    }
}

impl DeliverySink for DeliveryHub {
    fn on_terminal(&self, event: TerminalEvent) {
        if !launched_with_push(&event.parent_connection_id) {
            return;
        }
        let conversation_id = event.parent_conversation_id;
        {
            let mut slots = self.lock();
            let slot = slots.entry(conversation_id).or_default();
            slot.queue.retain(|q| q.task.task_id != event.task.task_id);
            slot.queue.push(Queued {
                task: event.task,
                wakes: event.cause.wakes(),
            });
            Self::trim(&mut slots);
        }
        // Spawning needs a runtime; the broker always runs on one.
        if tokio::runtime::Handle::try_current().is_ok() {
            self.schedule(conversation_id);
        }
    }

    fn on_consumed(&self, task_ids: &[String]) {
        if task_ids.is_empty() {
            return;
        }
        let mut slots = self.lock();
        for slot in slots.values_mut() {
            slot.queue.retain(|q| !task_ids.contains(&q.task.task_id));
        }
    }
}

// ── The global handle the manager reaches ────────────────────────────────────

static HUB: OnceLock<Arc<DeliveryHub>> = OnceLock::new();

pub fn hub() -> Option<&'static Arc<DeliveryHub>> {
    HUB.get()
}

/// Who a prompt `ConnectionManager::send_prompt_linked_full` sends comes from.
pub enum PromptOrigin {
    /// The user, an automation, a chat channel — anyone but this module.
    User,
    /// A wake: the prompt is a results frame, already rendered.
    DelegationWake {
        conversation_id: i32,
        notice: RenderedNotice,
    },
}

impl PromptOrigin {
    pub fn is_user(&self) -> bool {
        matches!(self, PromptOrigin::User)
    }

    /// A wake only goes to the conversation it was rendered for.
    pub fn check_target(&self, bound_conversation_id: Option<i32>) -> Result<(), AcpError> {
        match self {
            PromptOrigin::User => Ok(()),
            PromptOrigin::DelegationWake {
                conversation_id, ..
            } if bound_conversation_id == Some(*conversation_id) => Ok(()),
            PromptOrigin::DelegationWake { .. } => Err(AcpError::protocol(
                "delegation results are for another conversation".to_string(),
            )),
        }
    }

    /// The event announcing a wake, emitted just before it is sent.
    pub fn delivered_event(&self) -> Option<AcpEvent> {
        match self {
            PromptOrigin::User => None,
            PromptOrigin::DelegationWake { notice, .. } => Some(delivered_event(notice, None)),
        }
    }
}

fn delivered_event(notice: &RenderedNotice, message_id: Option<String>) -> AcpEvent {
    AcpEvent::DelegationResultsDelivered {
        id: notice.id.clone(),
        mode: notice.mode,
        tasks: notice.tasks.clone(),
        message_id,
    }
}

/// Results riding along with a prompt that is being sent.
pub struct AttachedResults(TakenBatch);

impl AttachedResults {
    /// The event that ties them to the user message `message_id`.
    pub fn event(&self, message_id: Option<String>) -> AcpEvent {
        delivered_event(&self.0.notice, message_id)
    }

    /// The prompt did not go out: queue them again.
    pub fn restore(self) {
        if let Some(hub) = hub() {
            hub.restore(self.0);
        }
    }
}

/// Append what is queued for the conversation to a prompt about to be sent.
/// Only for a root prompt (`root_prompt`: not a delegation child's own kickoff)
/// on a bound conversation, from anyone but this module.
pub async fn attach_to_prompt(
    origin: &PromptOrigin,
    root_prompt: bool,
    conversation_id: Option<i32>,
    suffix: &mut Vec<PromptInputBlock>,
) -> Option<AttachedResults> {
    if !origin.is_user() || !root_prompt {
        return None;
    }
    let batch = hub()?.take_for_prompt(conversation_id?).await?;
    suffix.push(PromptInputBlock::Text {
        text: batch.notice.text.clone(),
    });
    Some(AttachedResults(batch))
}

// ── Production wiring ────────────────────────────────────────────────────────

pub struct ManagerParentDriver {
    pub manager: Arc<ConnectionManager>,
    pub db: Arc<AppDatabase>,
    pub broker: Arc<DelegationBroker>,
}

#[async_trait]
impl ParentDriver for ManagerParentDriver {
    async fn parent(&self, conversation_id: i32) -> Option<ParentSnapshot> {
        let connection_id = self
            .manager
            .find_connection_by_conversation_id(conversation_id)
            .await?;
        let state = self.manager.get_state(&connection_id).await?;
        let s = state.read().await;
        Some(ParentSnapshot {
            turn_in_flight: s.turn_in_flight,
            can_steer: s.native_steering_available
                && s.pending_permission.is_none()
                && s.pending_question.is_none()
                && s.pending_plan_approval.is_none(),
            connection_id,
        })
    }

    async fn conversation_of(&self, connection_id: &str) -> Option<i32> {
        let state = self.manager.get_state(connection_id).await?;
        let id = state.read().await.conversation_id;
        id
    }

    async fn still_running(&self, conversation_id: i32) -> Vec<String> {
        self.broker
            .running_task_ids_for_conversation(conversation_id)
            .await
    }

    async fn steer(&self, connection_id: &str, notice: &RenderedNotice) -> SteerResult {
        use crate::acp::connection::{ConnectionCommand, SteerOutcome};
        let (cmd_tx, state, emitter) = {
            let connections = self.manager.connections.lock().await;
            let Some(conn) = connections.get(connection_id) else {
                return SteerResult::NotNow;
            };
            (
                conn.cmd_tx.clone(),
                conn.state.clone(),
                conn.emitter.clone(),
            )
        };
        {
            // The loop declines an open question before it steers, and an open
            // card would be raced: steer only into a turn nothing is waiting in.
            let s = state.read().await;
            if !s.turn_in_flight
                || !s.native_steering_available
                || s.pending_permission.is_some()
                || s.pending_question.is_some()
                || s.pending_plan_approval.is_some()
            {
                return SteerResult::NotNow;
            }
        }
        let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
        let command = ConnectionCommand::Steer {
            blocks: vec![PromptInputBlock::Text {
                text: notice.text.clone(),
            }],
            reply: reply_tx,
        };
        if cmd_tx.send(command).await.is_err() {
            return SteerResult::NotNow;
        }
        let outcome = match reply_rx.await {
            Ok(Ok(outcome)) => outcome,
            _ => return SteerResult::NotNow,
        };
        match outcome {
            SteerOutcome::PromptRequired => return SteerResult::NotNow,
            SteerOutcome::Injected => {}
            SteerOutcome::StartedNewTurn => {
                // Consumed all the same; see `submit_feedback_native`.
                state.write().await.native_steering_available = false;
            }
        }
        emit_with_state(&state, &emitter, delivered_event(notice, None)).await;
        SteerResult::Injected
    }

    async fn wake(
        &self,
        connection_id: &str,
        conversation_id: i32,
        notice: &RenderedNotice,
    ) -> WakeResult {
        match self
            .manager
            .send_delegation_wake(&self.db, connection_id, conversation_id, notice.clone())
            .await
        {
            Ok(_) => WakeResult::Sent,
            Err(AcpError::TurnInProgress) => WakeResult::Busy,
            Err(e) => {
                tracing::warn!(
                    "[delegation][push] waking conversation {conversation_id} failed: {e}"
                );
                WakeResult::Failed
            }
        }
    }

    async fn held_changed(&self, conversation_id: i32, held: bool) {
        let Some(connection_id) = self
            .manager
            .find_connection_by_conversation_id(conversation_id)
            .await
        else {
            return;
        };
        if let Some((state, emitter)) = self.manager.get_state_and_emitter(&connection_id).await {
            emit_with_state(&state, &emitter, AcpEvent::DelegationPushHeld { held }).await;
        }
    }
}

/// What delivery needs from the process, handed over once at startup.
pub struct Runtime {
    pub db: Arc<AppDatabase>,
    pub emitter: EventEmitter,
    pub manager: Arc<ConnectionManager>,
    pub broker: Arc<DelegationBroker>,
    pub bus: Arc<InternalEventBus>,
}

/// Install the hub and hook it into the broker, returning the task that
/// follows parent turns on the bus — for the caller to spawn on its runtime
/// (the desktop setup runs outside one). Subscribes before returning, so no
/// turn end is missed. A second call installs nothing and returns a no-op.
pub fn start(runtime: Runtime) -> futures_util::future::BoxFuture<'static, ()> {
    // The task ledger rides along: same database, installed once.
    let ledger = Arc::new(super::ledger::DbLedger {
        db: runtime.db.clone(),
        emitter: runtime.emitter.clone(),
    });
    let ledger_broker = runtime.broker.clone();
    let driver = Arc::new(ManagerParentDriver {
        manager: runtime.manager,
        db: runtime.db,
        broker: runtime.broker.clone(),
    });
    let hub = DeliveryHub::new(driver, COALESCE, WAKE_CAP);
    if HUB.set(hub.clone()).is_err() {
        return Box::pin(async {});
    }
    runtime
        .broker
        .install_delivery(hub.clone() as Arc<dyn DeliverySink>);
    let mut rx = runtime.bus.subscribe();
    Box::pin(async move {
        use tokio::sync::broadcast::error::RecvError;
        ledger_broker.install_ledger(ledger).await;
        loop {
            let envelope = match rx.recv().await {
                Ok(envelope) => envelope,
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            };
            match &envelope.payload {
                AcpEvent::TurnComplete { stop_reason, .. } => {
                    let hub = hub.clone();
                    let connection_id = envelope.connection_id.clone();
                    let stop_reason = stop_reason.clone();
                    tokio::spawn(async move {
                        hub.on_turn_complete(&connection_id, &stop_reason).await;
                    });
                }
                AcpEvent::StatusChanged {
                    status: ConnectionStatus::Disconnected,
                } => forget_connection(&envelope.connection_id),
                _ => {}
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct FakeParent {
        /// conversation → snapshot
        parents: StdMutex<HashMap<i32, ParentSnapshot>>,
        steers: StdMutex<Vec<(String, RenderedNotice)>>,
        wakes: StdMutex<Vec<(String, RenderedNotice)>>,
        steer_result: StdMutex<Option<SteerResult>>,
        wake_result: StdMutex<Option<WakeResult>>,
        running: StdMutex<Vec<String>>,
        held: StdMutex<Vec<bool>>,
    }

    impl FakeParent {
        fn set(&self, conversation_id: i32, connection_id: &str, busy: bool, can_steer: bool) {
            self.parents.lock().unwrap().insert(
                conversation_id,
                ParentSnapshot {
                    connection_id: connection_id.to_string(),
                    turn_in_flight: busy,
                    can_steer,
                },
            );
        }
        fn wakes(&self) -> Vec<(String, RenderedNotice)> {
            self.wakes.lock().unwrap().clone()
        }
        fn steers(&self) -> Vec<(String, RenderedNotice)> {
            self.steers.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl ParentDriver for FakeParent {
        async fn parent(&self, conversation_id: i32) -> Option<ParentSnapshot> {
            self.parents.lock().unwrap().get(&conversation_id).cloned()
        }
        async fn conversation_of(&self, connection_id: &str) -> Option<i32> {
            self.parents
                .lock()
                .unwrap()
                .iter()
                .find(|(_, p)| p.connection_id == connection_id)
                .map(|(c, _)| *c)
        }
        async fn still_running(&self, _conversation_id: i32) -> Vec<String> {
            self.running.lock().unwrap().clone()
        }
        async fn steer(&self, connection_id: &str, notice: &RenderedNotice) -> SteerResult {
            let result = self
                .steer_result
                .lock()
                .unwrap()
                .unwrap_or(SteerResult::Injected);
            if result == SteerResult::Injected {
                self.steers
                    .lock()
                    .unwrap()
                    .push((connection_id.to_string(), notice.clone()));
            }
            result
        }
        async fn wake(
            &self,
            connection_id: &str,
            _conversation_id: i32,
            notice: &RenderedNotice,
        ) -> WakeResult {
            let result = self.wake_result.lock().unwrap().unwrap_or(WakeResult::Sent);
            if result == WakeResult::Sent {
                self.wakes
                    .lock()
                    .unwrap()
                    .push((connection_id.to_string(), notice.clone()));
                // The woken turn is now running.
                let mut parents = self.parents.lock().unwrap();
                for p in parents.values_mut() {
                    if p.connection_id == connection_id {
                        p.turn_in_flight = true;
                    }
                }
            }
            result
        }
        async fn held_changed(&self, _conversation_id: i32, held: bool) {
            self.held.lock().unwrap().push(held);
        }
    }

    const WINDOW: Duration = Duration::from_millis(40);

    fn hub_with(parent: &Arc<FakeParent>) -> Arc<DeliveryHub> {
        DeliveryHub::new(parent.clone() as Arc<dyn ParentDriver>, WINDOW, 3)
    }

    fn unique_conn(tag: &str) -> String {
        format!("{tag}-{}", uuid::Uuid::new_v4())
    }

    fn finished(
        conn: &str,
        conversation_id: i32,
        task_id: &str,
        cause: TerminalCause,
    ) -> TerminalEvent {
        TerminalEvent {
            parent_connection_id: conn.to_string(),
            parent_conversation_id: conversation_id,
            task: NoticeTask {
                task_id: task_id.to_string(),
                agent_type: "codex".into(),
                assistant: None,
                status: "completed".into(),
                duration_ms: 1000,
                text: Some(format!("result of {task_id}")),
                truncated: false,
                error_code: None,
                message: None,
                resumable: false,
                child_conversation_id: 9,
                worktree: None,
            },
            cause,
        }
    }

    async fn settle() {
        tokio::time::sleep(WINDOW * 3).await;
    }

    fn task_ids(notice: &RenderedNotice) -> Vec<String> {
        notice.tasks.iter().map(|t| t.task_id.clone()).collect()
    }

    #[tokio::test]
    async fn an_idle_parent_is_woken_once_for_siblings_that_finish_together() {
        let parent = Arc::new(FakeParent::default());
        let conn = unique_conn("p");
        note_companion_launch(&conn, true);
        parent.set(1, &conn, false, true);
        let hub = hub_with(&parent);
        hub.on_terminal(finished(&conn, 1, "a", TerminalCause::Finished));
        hub.on_terminal(finished(&conn, 1, "b", TerminalCause::Finished));
        settle().await;
        let wakes = parent.wakes();
        assert_eq!(wakes.len(), 1);
        assert_eq!(task_ids(&wakes[0].1), vec!["a", "b"]);
        assert_eq!(wakes[0].1.mode, DelegationResultsMode::Wake);
    }

    #[tokio::test]
    async fn a_busy_parent_with_steering_gets_the_results_injected() {
        let parent = Arc::new(FakeParent::default());
        let conn = unique_conn("p");
        note_companion_launch(&conn, true);
        parent.set(1, &conn, true, true);
        let hub = hub_with(&parent);
        hub.on_terminal(finished(&conn, 1, "a", TerminalCause::Finished));
        settle().await;
        assert!(parent.wakes().is_empty());
        let steers = parent.steers();
        assert_eq!(steers.len(), 1);
        assert_eq!(steers[0].1.mode, DelegationResultsMode::Steer);
    }

    #[tokio::test]
    async fn a_busy_parent_without_steering_is_woken_when_its_turn_ends() {
        let parent = Arc::new(FakeParent::default());
        let conn = unique_conn("p");
        note_companion_launch(&conn, true);
        parent.set(1, &conn, true, false);
        let hub = hub_with(&parent);
        hub.on_terminal(finished(&conn, 1, "a", TerminalCause::Finished));
        settle().await;
        assert!(parent.wakes().is_empty() && parent.steers().is_empty());
        parent.set(1, &conn, false, false);
        hub.on_turn_complete(&conn, "end_turn").await;
        settle().await;
        assert_eq!(parent.wakes().len(), 1);
    }

    #[tokio::test]
    async fn a_result_the_parent_pulled_is_not_pushed() {
        let parent = Arc::new(FakeParent::default());
        let conn = unique_conn("p");
        note_companion_launch(&conn, true);
        parent.set(1, &conn, false, true);
        let hub = hub_with(&parent);
        hub.on_terminal(finished(&conn, 1, "a", TerminalCause::Finished));
        hub.on_consumed(&["a".to_string()]);
        settle().await;
        assert!(parent.wakes().is_empty());
    }

    #[tokio::test]
    async fn a_user_cancel_never_wakes_but_rides_along_with_the_next_prompt() {
        let parent = Arc::new(FakeParent::default());
        let conn = unique_conn("p");
        note_companion_launch(&conn, true);
        parent.set(1, &conn, false, true);
        let hub = hub_with(&parent);
        hub.on_terminal(finished(&conn, 1, "a", TerminalCause::UserCanceled));
        settle().await;
        assert!(parent.wakes().is_empty());
        let batch = hub.take_for_prompt(1).await.expect("queued");
        assert_eq!(batch.notice.mode, DelegationResultsMode::Attached);
        assert_eq!(task_ids(&batch.notice), vec!["a"]);
        assert!(hub.take_for_prompt(1).await.is_none());
    }

    #[tokio::test]
    async fn a_failed_or_stopped_turn_pauses_waking_until_the_next_prompt() {
        let parent = Arc::new(FakeParent::default());
        let conn = unique_conn("p");
        note_companion_launch(&conn, true);
        parent.set(1, &conn, false, true);
        let hub = hub_with(&parent);
        hub.on_turn_complete(&conn, "max_tokens").await;
        hub.on_terminal(finished(&conn, 1, "a", TerminalCause::ChildFailed));
        settle().await;
        assert!(parent.wakes().is_empty());
        // The next prompt carries it, and lifts the pause.
        let batch = hub.take_for_prompt(1).await.expect("queued");
        assert_eq!(task_ids(&batch.notice), vec!["a"]);
        settle().await;
        assert_eq!(*parent.held.lock().unwrap(), vec![true, false]);
        hub.on_terminal(finished(&conn, 1, "b", TerminalCause::Finished));
        settle().await;
        assert_eq!(parent.wakes().len(), 1);
    }

    #[tokio::test]
    async fn waking_pauses_after_the_cap_until_someone_else_prompts() {
        let parent = Arc::new(FakeParent::default());
        let conn = unique_conn("p");
        note_companion_launch(&conn, true);
        let hub = hub_with(&parent); // cap 3
        for i in 0..4 {
            parent.set(1, &conn, false, true);
            hub.on_terminal(finished(
                &conn,
                1,
                &format!("t{i}"),
                TerminalCause::Finished,
            ));
            settle().await;
        }
        assert_eq!(parent.wakes().len(), 3);
        let batch = hub.take_for_prompt(1).await.expect("the fourth waited");
        assert_eq!(task_ids(&batch.notice), vec!["t3"]);
    }

    #[tokio::test]
    async fn a_session_launched_without_push_is_left_to_poll() {
        let parent = Arc::new(FakeParent::default());
        let conn = unique_conn("p");
        note_companion_launch(&conn, false);
        parent.set(1, &conn, false, true);
        let hub = hub_with(&parent);
        hub.on_terminal(finished(&conn, 1, "a", TerminalCause::Finished));
        settle().await;
        assert!(parent.wakes().is_empty());
        assert!(hub.take_for_prompt(1).await.is_none());
    }

    #[tokio::test]
    async fn results_follow_the_conversation_to_a_new_connection() {
        let parent = Arc::new(FakeParent::default());
        let old = unique_conn("old");
        let new = unique_conn("new");
        note_companion_launch(&old, true);
        note_companion_launch(&new, true);
        // The child finished while the parent had no live session.
        let hub = hub_with(&parent);
        hub.on_terminal(finished(&old, 1, "a", TerminalCause::Finished));
        settle().await;
        assert!(parent.wakes().is_empty());
        // Reopened on a new connection: its next turn end delivers.
        parent.set(1, &new, false, true);
        hub.on_turn_complete(&new, "end_turn").await;
        settle().await;
        let wakes = parent.wakes();
        assert_eq!(wakes.len(), 1);
        assert_eq!(wakes[0].0, new);
    }

    #[tokio::test]
    async fn a_wake_that_loses_the_race_to_a_prompt_is_retried() {
        let parent = Arc::new(FakeParent::default());
        let conn = unique_conn("p");
        note_companion_launch(&conn, true);
        parent.set(1, &conn, false, false);
        *parent.wake_result.lock().unwrap() = Some(WakeResult::Busy);
        let hub = hub_with(&parent);
        hub.on_terminal(finished(&conn, 1, "a", TerminalCause::Finished));
        settle().await;
        assert!(parent.wakes().is_empty());
        *parent.wake_result.lock().unwrap() = None;
        settle().await;
        assert_eq!(parent.wakes().len(), 1);
    }

    #[test]
    fn only_the_user_stopping_a_turn_cancels_its_delegations() {
        assert!(turn_end_cancels_children("cancelled"));
        for reason in [
            "end_turn",
            "max_tokens",
            "refusal",
            "rejected",
            "auth_required",
            "empty",
        ] {
            assert!(!turn_end_cancels_children(reason), "{reason}");
        }
    }
}
