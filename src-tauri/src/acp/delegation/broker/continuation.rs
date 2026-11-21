//! keh4l build: `continue_delegation` — give a FINISHED delegated task more
//! work in the same child session (its context, directory or worktree, and
//! launch options intact), as a new round with a task id of its own.
//!
//! Unlike `resume_delegation` (an interrupted task carries on, same id, no new
//! instructions), a continuation takes new instructions and only follows the
//! LATEST round of a task that is not running. It is refused rather than
//! quietly started in a fresh session when the child's session cannot be
//! loaded again: a cold child would answer as if it had done nothing. Rounds
//! live in the task ledger (`crate::acp::delegation::ledger`), which also lets
//! `get_delegation_status` answer for them after a restart.

use std::time::Instant;

use sha2::{Digest, Sha256};

use super::fork_launch::ForkTaskInfo;
use super::{
    completed_report, truncate_on_char_boundary, unknown_report, DelegationBroker, RunningTask,
    TASK_PREVIEW_CAP,
};
use crate::acp::delegation::fork_launch::Isolation;
use crate::acp::delegation::ledger::{DelegationLedger, LedgerRow};
use crate::acp::delegation::meta_writer::build_delegation_meta;
use crate::acp::delegation::types::{AssistantRef, DelegationTaskReport, TaskStatus};
use crate::models::delegation_results::DelegationWorktreeInfo;
use crate::models::AgentType;

/// One `continue_delegation` call.
#[derive(Debug, Clone)]
pub struct ContinueDelegationRequest {
    pub parent_connection_id: String,
    pub parent_conversation_id: i32,
    /// The call's own tool_use_id, when the host passed it (`_meta`).
    pub parent_tool_use_id: Option<String>,
    /// The round to continue.
    pub task_id: String,
    pub task: String,
    pub external_handle: Option<String>,
}

/// Where `resume_delegation` finds a task's session and card.
pub(super) struct ResumeTarget {
    /// The task id the child's conversation row goes by.
    pub lookup_id: String,
    /// The card a continued round's progress belongs on.
    pub parent_tool_use_id: Option<String>,
}

/// How long the new instructions may be.
const CONTINUE_TASK_CAP: usize = 64 * 1024;

fn refused(
    task_id: &str,
    code: &str,
    status: TaskStatus,
    agent_type: Option<AgentType>,
    message: String,
) -> DelegationTaskReport {
    DelegationTaskReport {
        task_id: Some(task_id.to_string()),
        status,
        child_conversation_id: None,
        agent_type,
        text: None,
        error_code: Some(code.to_string()),
        message: Some(message),
        duration_ms: None,
        blocked_on: None,
        assistant_id: None,
        assistant_name: None,
        progress: None,
    }
}

pub(crate) fn request_hash(task: &str) -> String {
    let digest = Sha256::digest(task.trim().as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn ledger_status(status: &str) -> TaskStatus {
    match status {
        "running" => TaskStatus::Running,
        "completed" => TaskStatus::Completed,
        "canceled" => TaskStatus::Canceled,
        _ => TaskStatus::Failed,
    }
}

/// The prompt a continued child receives: plainly marked as coming from the
/// agent that delegated to it, with its round.
pub fn continuation_prompt(round: i32, task: &str) -> String {
    format!(
        "Follow-up from the agent that delegated this task to you (round {round}). Continue in \
         this session, with everything you did so far:\n\n{}",
        task.trim()
    )
}

impl DelegationBroker {
    /// The task id that `conversation_id`'s running round goes by, when the
    /// child conversation has one running here — a continued round's id
    /// differs from the `delegation_call_id` its conversation row keeps.
    pub async fn running_call_id_for_child_conversation(
        &self,
        child_conversation_id: i32,
    ) -> Option<String> {
        let inner = self.pending.inner.lock().await;
        inner
            .running
            .iter()
            .find(|(_, t)| t.child_conversation_id == child_conversation_id)
            .map(|(id, _)| id.clone())
    }

    async fn latest_round(&self, ledger: &dyn DelegationLedger, mut row: LedgerRow) -> LedgerRow {
        for _ in 0..1024 {
            match ledger.successor_of(&row.task_id).await {
                Some(next) => row = next,
                None => break,
            }
        }
        row
    }

    async fn root_round(&self, ledger: &dyn DelegationLedger, mut row: LedgerRow) -> LedgerRow {
        for _ in 0..1024 {
            let Some(source) = row.source_task_id.clone() else {
                break;
            };
            match ledger.get(&source).await {
                Some(prev) => row = prev,
                None => break,
            }
        }
        row
    }

    /// A round's report from memory, else from the ledger.
    pub(crate) async fn round_report(&self, row: &LedgerRow) -> DelegationTaskReport {
        {
            let inner = self.pending.inner.lock().await;
            if let Some(c) = inner.completed.get(&row.task_id) {
                return completed_report(&row.task_id, c);
            }
            if inner.running.contains_key(&row.task_id) {
                return DelegationTaskReport {
                    task_id: Some(row.task_id.clone()),
                    status: TaskStatus::Running,
                    child_conversation_id: row.child_conversation_id,
                    agent_type: AgentType::from_wire(&row.agent_type),
                    text: None,
                    error_code: None,
                    message: Some(format!(
                        "Continuation running. task_id={} (round {}).",
                        row.task_id, row.round
                    )),
                    duration_ms: None,
                    blocked_on: None,
                    assistant_id: row.assistant_id,
                    assistant_name: row.assistant_name.clone(),
                    progress: None,
                };
            }
        }
        let status = ledger_status(&row.status);
        DelegationTaskReport {
            task_id: Some(row.task_id.clone()),
            status,
            child_conversation_id: row.child_conversation_id,
            agent_type: AgentType::from_wire(&row.agent_type),
            text: (status == TaskStatus::Completed)
                .then(|| row.result_preview.clone())
                .flatten(),
            error_code: row.error_code.clone(),
            message: Some(match status {
                TaskStatus::Completed => format!(
                    "Round {} of this task completed; the result above is its opening \
                     (open the sub-agent's session for all of it).",
                    row.round
                ),
                TaskStatus::Running => format!(
                    "Round {} was still running when Codeg last knew of it.",
                    row.round
                ),
                _ => format!("Round {} ended: {}.", row.round, row.status),
            }),
            duration_ms: row.duration_ms,
            blocked_on: None,
            assistant_id: row.assistant_id,
            assistant_name: row.assistant_name.clone(),
            progress: None,
        }
    }

    /// Fill in a task the broker's memory and the conversation rows no longer
    /// know (a continued round after a restart) from the ledger.
    pub(super) async fn fork_fill_unknown(
        &self,
        parent_conversation_id: Option<i32>,
        reports: &mut [DelegationTaskReport],
    ) {
        let Some(ledger) = self.ledger().cloned() else {
            return;
        };
        for report in reports.iter_mut() {
            if report.status != TaskStatus::Unknown {
                continue;
            }
            let Some(id) = report.task_id.clone() else {
                continue;
            };
            let Some(row) = ledger.get(&id).await else {
                continue;
            };
            if parent_conversation_id != Some(row.parent_conversation_id) {
                continue;
            }
            *report = self.round_report(&row).await;
        }
    }

    /// `resume_delegation` of a round of a continued task: its session is
    /// the first round's (whose id the child's conversation row keeps), its
    /// card the continuation call's. A round continued since is not resumed —
    /// the work went on in the next one.
    pub(super) async fn fork_resume_target(
        &self,
        parent_conversation_id: i32,
        task_id: &str,
    ) -> Result<ResumeTarget, Box<DelegationTaskReport>> {
        let plain = ResumeTarget {
            lookup_id: task_id.to_string(),
            parent_tool_use_id: None,
        };
        let Some(ledger) = self.ledger().cloned() else {
            return Ok(plain);
        };
        let Some(row) = ledger.get(task_id).await else {
            return Ok(plain);
        };
        if row.parent_conversation_id != parent_conversation_id {
            return Ok(plain);
        }
        if let Some(next) = ledger.successor_of(task_id).await {
            let latest = self.latest_round(ledger.as_ref(), next).await;
            return Err(Box::new(refused(
                task_id,
                "not_latest_round",
                ledger_status(&row.status),
                AgentType::from_wire(&row.agent_type),
                format!(
                    "this task was continued since, so this round is not resumed; resume or \
                     continue its latest round instead: task_id={} (round {})",
                    latest.task_id, latest.round
                ),
            )));
        }
        if row.round <= 1 {
            return Ok(plain);
        }
        let root = self.root_round(ledger.as_ref(), row.clone()).await;
        Ok(ResumeTarget {
            lookup_id: root.task_id,
            parent_tool_use_id: row.parent_tool_use_id,
        })
    }

    /// Backs `continue_delegation`.
    pub async fn continue_delegation(
        &self,
        req: ContinueDelegationRequest,
    ) -> DelegationTaskReport {
        self.note_task_consumed(&req.task_id);
        let source_id = req.task_id.clone();
        let task = req.task.trim().to_string();
        if task.is_empty() {
            return refused(
                &source_id,
                "invalid_task",
                TaskStatus::Failed,
                None,
                "continue_delegation needs the new instructions in task".into(),
            );
        }
        if task.len() > CONTINUE_TASK_CAP {
            return refused(
                &source_id,
                "invalid_task",
                TaskStatus::Failed,
                None,
                format!("task is longer than {CONTINUE_TASK_CAP} bytes"),
            );
        }
        if !self.config_snapshot().await.enabled {
            return refused(
                &source_id,
                "delegation_disabled",
                TaskStatus::Failed,
                None,
                "multi-agent delegation is turned off".into(),
            );
        }
        {
            let inner = self.pending.inner.lock().await;
            if let Some(running) = inner.running.get(&source_id) {
                if running.parent_conversation_id == req.parent_conversation_id {
                    return refused(
                        &source_id,
                        "task_running",
                        TaskStatus::Running,
                        Some(running.agent_type),
                        "the task is still running — its result comes back when it finishes; \
                         continue it after that, or cancel it first"
                            .into(),
                    );
                }
            }
        }
        let Some(ledger) = self.ledger().cloned() else {
            return unknown_report(&source_id);
        };
        let Some(source) = ledger.get(&source_id).await else {
            return unknown_report(&source_id);
        };
        if source.parent_conversation_id != req.parent_conversation_id {
            return unknown_report(&source_id);
        }
        let agent_type = AgentType::from_wire(&source.agent_type);
        let hash = request_hash(&task);
        if let Some(next) = ledger.successor_of(&source_id).await {
            if next.request_hash.as_deref() == Some(hash.as_str()) {
                return self.round_report(&next).await;
            }
            let latest = self.latest_round(ledger.as_ref(), next).await;
            return refused(
                &source_id,
                "not_latest_round",
                TaskStatus::Failed,
                agent_type,
                format!(
                    "this round was already continued; continue the latest round instead: \
                     task_id={} (round {})",
                    latest.task_id, latest.round
                ),
            );
        }
        let root = self.root_round(ledger.as_ref(), source.clone()).await;
        let ctx = self
            .status_lookup
            .find_resume_context_by_call_id(&root.task_id)
            .await;
        let (Some(ctx), Some(agent_type)) = (ctx, agent_type) else {
            return refused(
                &source_id,
                "session_unavailable",
                TaskStatus::Failed,
                agent_type,
                "the sub-agent's conversation is gone, so there is no session to continue; \
                 delegate a new task instead"
                    .into(),
            );
        };
        let Some(external_id) = ctx.external_id.clone() else {
            return refused(
                &source_id,
                "session_unavailable",
                TaskStatus::Failed,
                Some(agent_type),
                "the sub-agent's session was never recorded, so it cannot be loaded again; \
                 delegate a new task instead"
                    .into(),
            );
        };

        // The round's card: the call's own tool_use_id when the host passed
        // it. Otherwise not `delegation-*` (which the broker treats as "no
        // card"): the card binds by the task id its ack names, so the round's
        // started and completed events must go out. A meta write for it is a
        // no-op.
        let parent_tool_use_id = req
            .parent_tool_use_id
            .clone()
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| format!("continuation-{}", uuid::Uuid::new_v4()));

        // Claim the next round: the source's successor slot is unique, so of
        // two calls racing here only one gets on.
        let call_id = uuid::Uuid::new_v4().to_string();
        let round = source.round + 1;
        let mut row = source.clone();
        row.task_id = call_id.clone();
        row.round = round;
        row.source_task_id = Some(source_id.clone());
        row.child_conversation_id = Some(ctx.child_conversation_id);
        row.parent_tool_use_id = Some(parent_tool_use_id.clone());
        row.task_text = Some(truncate_on_char_boundary(&task, 16 * 1024));
        row.request_hash = Some(hash.clone());
        row.status = "running".into();
        row.error_code = None;
        row.duration_ms = None;
        row.result_preview = None;
        if !ledger.insert(row).await {
            if let Some(next) = ledger.successor_of(&source_id).await {
                if next.request_hash.as_deref() == Some(hash.as_str()) {
                    return self.round_report(&next).await;
                }
            }
            return refused(
                &source_id,
                "continuation_conflict",
                TaskStatus::Failed,
                Some(agent_type),
                "another continuation of this round got there first; check the task's latest \
                 round with get_delegation_status"
                    .into(),
            );
        }
        let fail = |code: &str, message: String| {
            let ledger = ledger.clone();
            let call_id = call_id.clone();
            let code = code.to_string();
            async move {
                ledger
                    .finish(&call_id, "failed", Some(code.clone()), 0, None)
                    .await;
                refused(
                    &call_id,
                    &code,
                    TaskStatus::Failed,
                    Some(agent_type),
                    message,
                )
            }
        };

        let working_dir = source.working_dir.clone().or(ctx.working_dir.clone());
        let spawned = match self
            .spawner
            .spawn_for_resume(
                &req.parent_connection_id,
                agent_type,
                working_dir,
                &external_id,
                source.launch.mode_id.clone(),
                source.launch.config.clone(),
            )
            .await
        {
            Ok(s) => s,
            Err(e) => {
                return fail(
                    "session_unavailable",
                    format!("the sub-agent's session could not be loaded again: {e}"),
                )
                .await
            }
        };
        let child_connection_id = spawned.connection_id.clone();
        if let Some(session) = self.spawner.child_session_id(&child_connection_id).await {
            if session != external_id {
                if !spawned.reused {
                    let _ = self.spawner.disconnect(&child_connection_id).await;
                }
                return fail(
                    "session_unavailable",
                    "the agent could not load the sub-agent's session and opened a new, empty \
                     one instead; it was closed. Delegate a new task instead."
                        .into(),
                )
                .await;
            }
        }

        let assistant = match (source.assistant_id, source.assistant_name.clone()) {
            (Some(id), Some(name)) => Some(AssistantRef { id, name }),
            _ => None,
        };
        let task_preview = truncate_on_char_boundary(&task, TASK_PREVIEW_CAP);
        self.put_fork_task(
            &call_id,
            ForkTaskInfo {
                model: source.requested_model.clone(),
                config: Default::default(),
                isolation: if source.isolation == "worktree" {
                    Isolation::Worktree
                } else {
                    Isolation::Shared
                },
                worktree: match (&source.worktree_path, &source.worktree_branch) {
                    (Some(path), Some(branch)) => Some(DelegationWorktreeInfo {
                        path: path.clone(),
                        branch: branch.clone(),
                        base_sha: source.worktree_base_sha.clone().unwrap_or_default(),
                        changes: None,
                    }),
                    _ => None,
                },
                round,
                notes: Vec::new(),
            },
        );
        {
            let mut inner = self.pending.inner.lock().await;
            inner.running.insert(
                call_id.clone(),
                RunningTask {
                    child_connection_id: child_connection_id.clone(),
                    child_conversation_id: ctx.child_conversation_id,
                    parent_connection_id: req.parent_connection_id.clone(),
                    parent_conversation_id: req.parent_conversation_id,
                    parent_tool_use_id: parent_tool_use_id.clone(),
                    agent_type,
                    assistant: assistant.clone(),
                    task_preview: task_preview.clone(),
                    task_id: call_id.clone(),
                    external_handle: req.external_handle.clone(),
                    started_at: Instant::now(),
                    last_surfaced_block: None,
                },
            );
        }
        self.emit_started_if_real(
            &req.parent_connection_id,
            &parent_tool_use_id,
            &child_connection_id,
            ctx.child_conversation_id,
            agent_type,
            assistant.as_ref(),
            &task_preview,
            &call_id,
        )
        .await;
        self.write_meta_if_real(
            &req.parent_connection_id,
            &parent_tool_use_id,
            build_delegation_meta(
                "running",
                Some(&child_connection_id),
                Some(ctx.child_conversation_id),
                None,
                None,
                None,
                Some(&task_preview),
                Some(&call_id),
                assistant.as_ref(),
            ),
        )
        .await;
        if let Err(e) = self
            .spawner
            .send_resume_prompt(
                &child_connection_id,
                continuation_prompt(round, &task),
                ctx.folder_id,
                ctx.child_conversation_id,
                None,
            )
            .await
        {
            let removed = {
                let mut inner = self.pending.inner.lock().await;
                inner.running.remove(&call_id)
            };
            if let Some(task) = removed {
                self.teardown_canceled_child(&task, 0, false).await;
            }
            self.result_notify.notify_waiters();
            return fail(
                "send_failed",
                format!("the follow-up could not be sent to the sub-agent: {e}"),
            )
            .await;
        }
        DelegationTaskReport {
            task_id: Some(call_id.clone()),
            status: TaskStatus::Running,
            child_conversation_id: Some(ctx.child_conversation_id),
            agent_type: Some(agent_type),
            text: None,
            error_code: None,
            message: Some(format!(
                "Continuation started. task_id={call_id} — round {round} of task {source_id}, in \
                 the same sub-agent session. This is a new task id: collect it, cancel it or \
                 continue it again by this id."
            )),
            duration_ms: None,
            blocked_on: None,
            assistant_id: assistant.as_ref().map(|a| a.id),
            assistant_name: assistant.as_ref().map(|a| a.name.clone()),
            progress: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_instructions_hash_the_same() {
        assert_eq!(request_hash(" fix it \n"), request_hash("fix it"));
        assert_ne!(request_hash("fix it"), request_hash("fix that"));
    }

    #[test]
    fn the_prompt_names_the_round() {
        let prompt = continuation_prompt(2, "  also add tests ");
        // `continuationRoundOf` in src/lib/delegation-launch.ts labels the
        // sub-agent's transcript by this opening.
        assert!(prompt
            .starts_with("Follow-up from the agent that delegated this task to you (round 2)."));
        assert!(prompt.ends_with("also add tests"));
    }

    // -- the broker with a ledger: per-call options, continuation, resume ----

    use std::collections::{BTreeMap, HashMap};
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;

    use async_trait::async_trait;

    use crate::acp::delegation::broker::{
        ChildResumeContext, ChildStatusLookup, ChildStatusRecord, ConversationDepthLookup,
        DelegationConfig, ResumeAssistant,
    };
    use crate::acp::delegation::fork_launch::ForkDelegationExtras;
    use crate::acp::delegation::ledger::DelegationLedger;
    use crate::acp::delegation::spawner::mock::MockSpawner;
    use crate::acp::delegation::spawner::{
        ConnectionSpawner, DelegationLink, ResumedSpawn, SpawnerError,
    };
    use crate::acp::delegation::types::{
        DelegationError, DelegationOutcome, DelegationRequest, DelegationSuccess,
        ResumeDelegationRequest,
    };
    use crate::acp::types::{
        SessionConfigKindInfo, SessionConfigOptionInfo, SessionConfigSelectInfo,
        SessionConfigSelectOptionInfo,
    };

    #[derive(Default)]
    struct MemLedger {
        rows: StdMutex<HashMap<String, LedgerRow>>,
    }

    impl MemLedger {
        fn row(&self, task_id: &str) -> Option<LedgerRow> {
            self.rows.lock().unwrap().get(task_id).cloned()
        }
    }

    #[async_trait]
    impl DelegationLedger for MemLedger {
        async fn insert(&self, row: LedgerRow) -> bool {
            let mut rows = self.rows.lock().unwrap();
            let taken = rows.contains_key(&row.task_id)
                || row.source_task_id.as_ref().is_some_and(|source| {
                    rows.values()
                        .any(|r| r.source_task_id.as_ref() == Some(source))
                });
            if taken {
                return false;
            }
            rows.insert(row.task_id.clone(), row);
            true
        }
        async fn set_child_conversation(&self, task_id: &str, child: i32) {
            if let Some(r) = self.rows.lock().unwrap().get_mut(task_id) {
                r.child_conversation_id = Some(child);
            }
        }
        async fn finish(
            &self,
            task_id: &str,
            status: &str,
            error_code: Option<String>,
            duration_ms: u64,
            result_preview: Option<String>,
        ) {
            if let Some(r) = self.rows.lock().unwrap().get_mut(task_id) {
                r.status = status.to_string();
                r.error_code = error_code;
                r.duration_ms = Some(duration_ms);
                r.result_preview = result_preview;
            }
        }
        async fn mark_running(&self, task_id: &str) {
            if let Some(r) = self.rows.lock().unwrap().get_mut(task_id) {
                r.status = "running".into();
                r.error_code = None;
            }
        }
        async fn get(&self, task_id: &str) -> Option<LedgerRow> {
            self.row(task_id)
        }
        async fn successor_of(&self, task_id: &str) -> Option<LedgerRow> {
            self.rows
                .lock()
                .unwrap()
                .values()
                .find(|r| r.source_task_id.as_deref() == Some(task_id))
                .cloned()
        }
        async fn worktree_location(&self, _parent: i32) -> Option<String> {
            None
        }
        async fn register_worktree_folder(&self, _parent: i32, _path: &str) {}
    }

    /// The mock spawner, plus what a real child reports: its options and the
    /// session it holds.
    struct Spawner {
        mock: Arc<MockSpawner>,
        options: Vec<SessionConfigOptionInfo>,
        session: StdMutex<Option<String>>,
    }

    #[async_trait]
    impl ConnectionSpawner for Spawner {
        async fn spawn(
            &self,
            parent: &str,
            agent_type: AgentType,
            working_dir: Option<String>,
            mode: Option<String>,
            config: BTreeMap<String, String>,
        ) -> Result<String, SpawnerError> {
            self.mock
                .spawn(parent, agent_type, working_dir, mode, config)
                .await
        }
        async fn send_prompt_linked_for_delegation(
            &self,
            conn_id: &str,
            task: String,
            link: DelegationLink,
            brief: Option<String>,
        ) -> Result<i32, SpawnerError> {
            self.mock
                .send_prompt_linked_for_delegation(conn_id, task, link, brief)
                .await
        }
        async fn spawn_for_resume(
            &self,
            parent: &str,
            agent_type: AgentType,
            working_dir: Option<String>,
            external: &str,
            mode: Option<String>,
            config: BTreeMap<String, String>,
        ) -> Result<ResumedSpawn, SpawnerError> {
            self.mock
                .spawn_for_resume(parent, agent_type, working_dir, external, mode, config)
                .await
        }
        async fn send_resume_prompt(
            &self,
            conn_id: &str,
            prompt: String,
            folder_id: i32,
            child: i32,
            brief: Option<String>,
        ) -> Result<(), SpawnerError> {
            self.mock
                .send_resume_prompt(conn_id, prompt, folder_id, child, brief)
                .await
        }
        async fn has_live_connection_for_conversation(&self, id: i32) -> bool {
            self.mock.has_live_connection_for_conversation(id).await
        }
        async fn cancel(&self, conn_id: &str) -> Result<(), SpawnerError> {
            self.mock.cancel(conn_id).await
        }
        async fn disconnect(&self, conn_id: &str) -> Result<(), SpawnerError> {
            self.mock.disconnect(conn_id).await
        }
        async fn child_config_options(
            &self,
            _conn_id: &str,
        ) -> Option<Vec<SessionConfigOptionInfo>> {
            (!self.options.is_empty()).then(|| self.options.clone())
        }
        async fn child_session_id(&self, _conn_id: &str) -> Option<String> {
            self.session.lock().unwrap().clone()
        }
    }

    struct RootDepth;

    #[async_trait]
    impl ConversationDepthLookup for RootDepth {
        async fn parent_of(&self, _id: i32) -> Result<Option<i32>, DelegationError> {
            Ok(None)
        }
    }

    /// The child row: known by the FIRST round's id only.
    #[derive(Default)]
    struct RowLookup {
        first_round: StdMutex<Option<String>>,
    }

    impl RowLookup {
        fn ctx(&self, call_id: &str) -> Option<ChildResumeContext> {
            (self.first_round.lock().unwrap().as_deref() == Some(call_id)).then(|| {
                ChildResumeContext {
                    child_conversation_id: 42,
                    status: TaskStatus::Canceled,
                    agent_type: AgentType::Codex,
                    parent_id: Some(7),
                    parent_tool_use_id: Some("tool-1".into()),
                    external_id: Some("ext-1".into()),
                    folder_id: 3,
                    working_dir: Some("/work".into()),
                    title: Some("do x".into()),
                    assistant: ResumeAssistant::None,
                }
            })
        }
    }

    #[async_trait]
    impl ChildStatusLookup for RowLookup {
        async fn find_by_call_id(&self, call_id: &str) -> Option<ChildStatusRecord> {
            self.ctx(call_id).map(|c| ChildStatusRecord {
                child_conversation_id: c.child_conversation_id,
                status: TaskStatus::Completed,
                agent_type: c.agent_type,
                parent_id: c.parent_id,
                assistant: None,
            })
        }
        async fn find_resume_context_by_call_id(
            &self,
            call_id: &str,
        ) -> Option<ChildResumeContext> {
            self.ctx(call_id)
        }
    }

    fn select(id: &str, values: &[&str]) -> SessionConfigOptionInfo {
        SessionConfigOptionInfo {
            id: id.into(),
            name: id.into(),
            description: None,
            category: None,
            kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
                current_value: values[0].into(),
                options: values
                    .iter()
                    .map(|v| SessionConfigSelectOptionInfo {
                        value: (*v).into(),
                        name: (*v).into(),
                        description: None,
                    })
                    .collect(),
                groups: vec![],
            }),
            recommended_value: None,
        }
    }

    struct Harness {
        broker: DelegationBroker,
        mock: Arc<MockSpawner>,
        spawner: Arc<Spawner>,
        ledger: Arc<MemLedger>,
        rows: Arc<RowLookup>,
    }

    async fn harness(options: Vec<SessionConfigOptionInfo>) -> Harness {
        let mock = Arc::new(MockSpawner::new());
        let spawner = Arc::new(Spawner {
            mock: mock.clone(),
            options,
            session: StdMutex::new(Some("ext-1".into())),
        });
        let rows = Arc::new(RowLookup::default());
        let broker = DelegationBroker::new(
            spawner.clone() as Arc<dyn ConnectionSpawner>,
            Arc::new(RootDepth) as Arc<dyn ConversationDepthLookup>,
        )
        .with_status_lookup(rows.clone() as Arc<dyn ChildStatusLookup>);
        broker
            .set_config(DelegationConfig {
                enabled: true,
                ..DelegationConfig::default()
            })
            .await;
        let ledger = Arc::new(MemLedger::default());
        broker
            .install_ledger(ledger.clone() as Arc<dyn DelegationLedger>)
            .await;
        Harness {
            broker,
            mock,
            spawner,
            ledger,
            rows,
        }
    }

    fn request(fork: ForkDelegationExtras) -> DelegationRequest {
        DelegationRequest {
            parent_connection_id: "parent-conn".into(),
            parent_conversation_id: 7,
            parent_tool_use_id: "tool-1".into(),
            agent_type: AgentType::Codex,
            task: "do x".into(),
            working_dir: None,
            requested_working_dir: None,
            external_handle: None,
            assistant: None,
            fork,
        }
    }

    fn ok(text: &str) -> DelegationOutcome {
        DelegationOutcome::Ok(DelegationSuccess {
            text: text.into(),
            child_conversation_id: 42,
            child_agent_type: AgentType::Codex,
            turn_count: 1,
            duration_ms: 5,
            token_usage: None,
        })
    }

    /// The ledger is written by a task of its own: wait for it.
    async fn settled(ledger: &MemLedger, task_id: &str, status: &str) -> LedgerRow {
        for _ in 0..200 {
            if let Some(row) = ledger.row(task_id) {
                if row.status == status {
                    return row;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        panic!("{task_id} never became {status}: {:?}", ledger.row(task_id));
    }

    /// Start round 1 and let it finish.
    async fn finished_first_round(h: &Harness) -> String {
        h.mock.queue_spawn(Ok("child-1".into())).await;
        h.mock.queue_send(Ok(42)).await;
        let report = h.broker.start_delegation(request(Default::default())).await;
        assert_eq!(report.status, TaskStatus::Running, "{report:?}");
        let id = report.task_id.unwrap();
        *h.rows.first_round.lock().unwrap() = Some(id.clone());
        h.broker.complete_call(&id, ok("first answer")).await;
        settled(&h.ledger, &id, "completed").await;
        id
    }

    fn continue_req(task_id: &str, task: &str) -> ContinueDelegationRequest {
        ContinueDelegationRequest {
            parent_connection_id: "parent-conn".into(),
            parent_conversation_id: 7,
            parent_tool_use_id: None,
            task_id: task_id.into(),
            task: task.into(),
            external_handle: None,
        }
    }

    #[tokio::test]
    async fn the_ledger_keeps_a_task_from_launch_to_end() {
        let h = harness(vec![]).await;
        let id = finished_first_round(&h).await;
        let row = h.ledger.row(&id).unwrap();
        assert_eq!(row.round, 1);
        assert_eq!(row.child_conversation_id, Some(42));
        assert_eq!(row.parent_tool_use_id.as_deref(), Some("tool-1"));
        assert_eq!(row.request_hash, Some(request_hash("do x")));
        assert_eq!(row.result_preview.as_deref(), Some("first answer"));
    }

    #[tokio::test]
    async fn a_model_the_child_lacks_stops_the_launch_with_the_choices() {
        let h = harness(vec![select("model", &["gpt-6.2", "gpt-6.2-mini"])]).await;
        h.mock.queue_spawn(Ok("child-1".into())).await;
        let report = h
            .broker
            .start_delegation(request(ForkDelegationExtras {
                model: Some("gpt-6".into()),
                ..Default::default()
            }))
            .await;
        assert_eq!(report.status, TaskStatus::Failed);
        assert_eq!(report.error_code.as_deref(), Some("invalid_launch_option"));
        assert!(report.message.unwrap().contains("gpt-6.2, gpt-6.2-mini"));
        assert_eq!(
            *h.mock.disconnects.lock().await,
            vec!["child-1".to_string()]
        );
        assert!(
            h.mock.send_args.lock().await.is_empty(),
            "never given the task"
        );
    }

    #[tokio::test]
    async fn the_call_s_options_go_over_the_defaults_and_into_the_ledger() {
        let h = harness(vec![
            select("model", &["gpt-6.2", "gpt-6.2-mini"]),
            select("reasoning_effort", &["medium", "high"]),
        ])
        .await;
        h.mock.queue_spawn(Ok("child-1".into())).await;
        h.mock.queue_send(Ok(42)).await;
        let report = h
            .broker
            .start_delegation(request(ForkDelegationExtras {
                model: Some("gpt-6.2-mini".into()),
                config: BTreeMap::from([("reasoning_effort".into(), "high".into())]),
                ..Default::default()
            }))
            .await;
        assert_eq!(report.status, TaskStatus::Running, "{report:?}");
        let spawned = h.mock.spawn_args.lock().await[0]
            .preferred_config_values
            .clone();
        assert_eq!(spawned["model"], "gpt-6.2-mini");
        assert_eq!(spawned["reasoning_effort"], "high");
        let row = settled(&h.ledger, report.task_id.as_deref().unwrap(), "running").await;
        assert_eq!(row.requested_model.as_deref(), Some("gpt-6.2-mini"));
        assert_eq!(row.launch.config, spawned);
    }

    #[tokio::test]
    async fn a_finished_task_continues_in_its_session_as_a_new_round() {
        let h = harness(vec![]).await;
        let first = finished_first_round(&h).await;
        h.mock
            .queue_resume_spawn(Ok(ResumedSpawn::fresh("child-2")))
            .await;
        h.mock.queue_resume_send(Ok(())).await;
        let report = h
            .broker
            .continue_delegation(continue_req(&first, "now add tests"))
            .await;
        assert_eq!(report.status, TaskStatus::Running, "{report:?}");
        let second = report.task_id.clone().unwrap();
        assert_ne!(second, first);
        assert!(report.message.unwrap().contains("round 2"));
        // Loaded the same session, and was told it is a follow-up.
        assert_eq!(
            h.mock.resume_spawn_args.lock().await[0].external_session_id,
            "ext-1"
        );
        let sent = h.mock.resume_send_args.lock().await[0].clone();
        assert_eq!(sent.child_conversation_id, 42);
        assert!(sent.prompt.starts_with("Follow-up from the agent"));
        assert!(sent.prompt.ends_with("now add tests"));
        // The child's turn end finds the round by its conversation.
        assert_eq!(
            h.broker.running_call_id_for_child_conversation(42).await,
            Some(second.clone())
        );
        let row = h.ledger.row(&second).unwrap();
        assert_eq!(
            (row.round, row.source_task_id.as_deref()),
            (2, Some(first.as_str()))
        );
        assert!(row
            .parent_tool_use_id
            .as_deref()
            .is_some_and(|id| id.starts_with("continuation-")));

        // Running: not continued again.
        let busy = h
            .broker
            .continue_delegation(continue_req(&second, "and docs"))
            .await;
        assert_eq!(busy.error_code.as_deref(), Some("task_running"));

        h.broker.complete_call(&second, ok("tests added")).await;
        settled(&h.ledger, &second, "completed").await;

        // The same follow-up again is the same round; another one must go to
        // the latest round.
        let again = h
            .broker
            .continue_delegation(continue_req(&first, "now add tests"))
            .await;
        assert_eq!(again.task_id.as_deref(), Some(second.as_str()));
        let stale = h
            .broker
            .continue_delegation(continue_req(&first, "something else"))
            .await;
        assert_eq!(stale.error_code.as_deref(), Some("not_latest_round"));
        assert!(stale.message.unwrap().contains(&second));
    }

    #[tokio::test]
    async fn a_session_the_agent_could_not_load_is_not_continued() {
        let h = harness(vec![]).await;
        let first = finished_first_round(&h).await;
        *h.spawner.session.lock().unwrap() = Some("a-new-empty-session".into());
        h.mock
            .queue_resume_spawn(Ok(ResumedSpawn::fresh("child-2")))
            .await;
        let report = h
            .broker
            .continue_delegation(continue_req(&first, "now add tests"))
            .await;
        assert_eq!(report.error_code.as_deref(), Some("session_unavailable"));
        assert!(h
            .mock
            .disconnects
            .lock()
            .await
            .contains(&"child-2".to_string()));
        assert!(h.mock.resume_send_args.lock().await.is_empty());
        let round = report.task_id.unwrap();
        assert_eq!(h.ledger.row(&round).unwrap().status, "failed");
    }

    #[tokio::test]
    async fn a_round_continued_since_is_not_resumed() {
        let h = harness(vec![]).await;
        // Round 1 is cut off (resumable), and continued instead.
        h.mock.queue_spawn(Ok("child-1".into())).await;
        h.mock.queue_send(Ok(42)).await;
        let first = h
            .broker
            .start_delegation(request(Default::default()))
            .await
            .task_id
            .unwrap();
        *h.rows.first_round.lock().unwrap() = Some(first.clone());
        h.broker
            .cancel_by_child_connection("child-1", Some("transport closed"))
            .await;
        settled(&h.ledger, &first, "canceled").await;
        h.mock
            .queue_resume_spawn(Ok(ResumedSpawn::fresh("child-2")))
            .await;
        h.mock.queue_resume_send(Ok(())).await;
        let second = h
            .broker
            .continue_delegation(continue_req(&first, "now add tests"))
            .await
            .task_id
            .unwrap();
        h.broker
            .cancel_by_child_connection("child-2", Some("transport closed"))
            .await;
        // A child connection that went away ends its round as canceled.
        settled(&h.ledger, &second, "canceled").await;

        let resume = |task_id: &str| ResumeDelegationRequest {
            parent_connection_id: "parent-conn".into(),
            parent_conversation_id: 7,
            task_id: task_id.into(),
            reason: None,
            external_handle: None,
        };
        let report = h.broker.resume_delegation(resume(&first)).await;
        assert_eq!(
            report.error_code.as_deref(),
            Some("not_latest_round"),
            "{report:?}"
        );
        assert!(report.message.unwrap().contains(&second));

        // The latest round resumes, in the session the first round's row
        // names, on its own card.
        h.mock
            .queue_resume_spawn(Ok(ResumedSpawn::fresh("child-3")))
            .await;
        h.mock.queue_resume_send(Ok(())).await;
        let resumed = h.broker.resume_delegation(resume(&second)).await;
        assert_eq!(resumed.status, TaskStatus::Running, "{resumed:?}");
        assert_eq!(resumed.task_id.as_deref(), Some(second.as_str()));
        assert_eq!(
            h.mock.resume_spawn_args.lock().await[1].external_session_id,
            "ext-1"
        );
        settled(&h.ledger, &second, "running").await;
    }
}
