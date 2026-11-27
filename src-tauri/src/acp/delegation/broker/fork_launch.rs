//! keh4l build: the broker's side of `isolation` / `model` / `config` on
//! `delegate_to_agent` (`crate::acp::delegation::fork_launch`), and of the
//! task ledger (`crate::acp::delegation::ledger`). A child module of the
//! broker, so `broker.rs` only carries one-line hooks.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::Arc;

use serde_json::{json, Value};

use super::{CompletedTask, DelegationBroker};
use crate::acp::delegation::fork_launch::{self, ForkDelegationExtras, Isolation};
use crate::acp::delegation::ledger::{
    DelegationLedger, LaunchRecord, LedgerRow, RESULT_PREVIEW_CAP,
};
use crate::acp::delegation::types::{DelegationRequest, DelegationTaskReport, TaskStatus};
use crate::acp::delegation::worktree::{self, DelegationWorktree};
use crate::models::delegation_results::DelegationWorktreeInfo;
use crate::models::AgentType;

/// Launch facts kept per task, for meta, reports and notices.
#[derive(Debug, Clone, Default)]
pub(crate) struct ForkTaskInfo {
    pub model: Option<String>,
    pub config: BTreeMap<String, String>,
    pub isolation: Isolation,
    pub worktree: Option<DelegationWorktreeInfo>,
    pub round: i32,
    pub notes: Vec<String>,
}

/// How long a launch check waits for the child's session.
const SESSION_WAIT: std::time::Duration = std::time::Duration::from_secs(60);
/// How long it waits for the options once the session is up.
const OPTIONS_GRACE: std::time::Duration = std::time::Duration::from_secs(2);

/// Tasks whose launch facts are kept; the oldest go first.
const KEPT: usize = 4096;

#[derive(Default)]
pub(crate) struct ForkTasks {
    by_id: HashMap<String, ForkTaskInfo>,
    order: VecDeque<String>,
}

impl ForkTasks {
    pub(crate) fn put(&mut self, task_id: &str, info: ForkTaskInfo) {
        if self.by_id.insert(task_id.to_string(), info).is_none() {
            self.order.push_back(task_id.to_string());
        }
        while self.order.len() > KEPT {
            if let Some(old) = self.order.pop_front() {
                self.by_id.remove(&old);
            }
        }
    }

    pub(crate) fn get(&self, task_id: &str) -> Option<&ForkTaskInfo> {
        self.by_id.get(task_id)
    }
}

/// What `fork_prepare_launch` settled for one call.
pub(super) struct ForkLaunch {
    pub mode_id: Option<String>,
    pub config: BTreeMap<String, String>,
    pub extras: ForkDelegationExtras,
    pub worktree: Option<DelegationWorktree>,
    pub notes: Vec<String>,
}

fn failed(agent_type: AgentType, code: &str, message: String) -> DelegationTaskReport {
    DelegationTaskReport {
        task_id: None,
        status: TaskStatus::Failed,
        child_conversation_id: None,
        agent_type: Some(agent_type),
        text: None,
        error_code: Some(code.to_string()),
        message: Some(message),
        duration_ms: None,
        blocked_on: None,
        assistant_id: None,
        assistant_name: None,
        bot: None,
        progress: None,
    }
}

fn short_label() -> (String, String) {
    let id = uuid::Uuid::new_v4().simple().to_string();
    (id[..8].to_string(), id[..12].to_string())
}

fn worktree_info(wt: &DelegationWorktree) -> DelegationWorktreeInfo {
    DelegationWorktreeInfo {
        path: wt.root.to_string_lossy().into_owned(),
        branch: wt.branch.clone(),
        base_sha: wt.base_sha.clone(),
        changes: None,
    }
}

fn cut(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => text[..end].to_string(),
        None => text.to_string(),
    }
}

fn status_word(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Completed => "completed",
        TaskStatus::Canceled => "canceled",
        TaskStatus::Running => "running",
        _ => "failed",
    }
}

/// One write to the task ledger.
pub(super) enum LedgerNote {
    Started(Box<LedgerRow>),
    Resumed(String),
    Finished {
        task_id: String,
        status: &'static str,
        error_code: Option<String>,
        duration_ms: u64,
        preview: Option<String>,
    },
}

/// The broker's writes to the ledger, sent under its pending lock — so a
/// task's row always goes out before its end — and applied in that order by
/// one writer task (`DelegationBroker::install_ledger`). Inert until then.
#[derive(Default)]
pub(super) struct LedgerFeed(Option<tokio::sync::mpsc::UnboundedSender<LedgerNote>>);

impl LedgerFeed {
    fn send(&self, note: LedgerNote) {
        if let Some(tx) = &self.0 {
            let _ = tx.send(note);
        }
    }

    /// `PendingInner::insert_completed`: every task's end comes through it.
    pub(super) fn finished(&self, task_id: &str, task: &CompletedTask) {
        if self.0.is_none() {
            return;
        }
        self.send(LedgerNote::Finished {
            task_id: task_id.to_string(),
            status: status_word(task.status),
            error_code: task.error_code.clone(),
            duration_ms: task.duration_ms,
            preview: task.text.as_deref().map(|t| cut(t, RESULT_PREVIEW_CAP)),
        });
    }

    /// A delegation reached its disposition: its row, with how it launched.
    pub(super) fn started(
        &self,
        call_id: &str,
        req: &DelegationRequest,
        child_conversation_id: i32,
        launch: &ForkLaunch,
    ) {
        if self.0.is_none() {
            return;
        }
        let mut row = LedgerRow::new(
            call_id,
            req.parent_conversation_id,
            &req.agent_type.as_wire(),
        );
        row.child_conversation_id = Some(child_conversation_id);
        row.parent_tool_use_id = Some(req.parent_tool_use_id.clone());
        row.assistant_id = req.assistant.as_ref().map(|a| a.id);
        row.assistant_name = req.assistant.as_ref().map(|a| a.name.clone());
        row.launch = LaunchRecord {
            mode_id: launch.mode_id.clone(),
            config: launch.config.clone(),
        };
        row.requested_model = launch.extras.model.clone();
        row.isolation = launch.extras.isolation.as_str().to_string();
        row.working_dir = req.working_dir.clone();
        row.task_text = Some(cut(&req.task, 16 * 1024));
        row.request_hash = Some(super::continuation::request_hash(&req.task));
        if let Some(wt) = &launch.worktree {
            row.worktree_repo = Some(wt.repository.to_string_lossy().into_owned());
            row.worktree_path = Some(wt.root.to_string_lossy().into_owned());
            row.worktree_branch = Some(wt.branch.clone());
            row.worktree_base_sha = Some(wt.base_sha.clone());
        }
        self.send(LedgerNote::Started(Box::new(row)));
    }

    /// A resume reached its disposition: the task runs again.
    pub(super) fn resumed(&self, task_id: &str) {
        self.send(LedgerNote::Resumed(task_id.to_string()));
    }
}

impl DelegationBroker {
    /// Hand the ledger to the broker and start its writer. A second call is
    /// ignored.
    pub async fn install_ledger(&self, ledger: Arc<dyn DelegationLedger>) {
        if self.ledger.set(ledger.clone()).is_err() {
            return;
        }
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        self.pending.inner.lock().await.fork_ledger = LedgerFeed(Some(tx));
        tokio::spawn(async move {
            while let Some(note) = rx.recv().await {
                match note {
                    LedgerNote::Started(row) => {
                        ledger.insert(*row).await;
                    }
                    LedgerNote::Resumed(task_id) => ledger.mark_running(&task_id).await,
                    LedgerNote::Finished {
                        task_id,
                        status,
                        error_code,
                        duration_ms,
                        preview,
                    } => {
                        ledger
                            .finish(&task_id, status, error_code, duration_ms, preview)
                            .await
                    }
                }
            }
        });
    }

    pub(crate) fn ledger(&self) -> Option<&Arc<dyn DelegationLedger>> {
        self.ledger.get()
    }

    pub(crate) fn fork_task(&self, task_id: &str) -> Option<ForkTaskInfo> {
        self.fork_tasks
            .lock()
            .expect("fork tasks poisoned")
            .get(task_id)
            .cloned()
    }

    pub(crate) fn put_fork_task(&self, task_id: &str, info: ForkTaskInfo) {
        self.fork_tasks
            .lock()
            .expect("fork tasks poisoned")
            .put(task_id, info);
    }

    /// Before the child is spawned: lay the call's options over the chosen
    /// ones, and make its worktree (pointing `req.working_dir` into it).
    pub(super) async fn fork_prepare_launch(
        &self,
        req: &mut DelegationRequest,
        mode_id: Option<String>,
        config: BTreeMap<String, String>,
    ) -> Result<ForkLaunch, Box<DelegationTaskReport>> {
        let extras = req.fork.clone();
        let (mode_id, config) = fork_launch::overlay(mode_id, config, &extras);
        let mut notes = Vec::new();
        let worktree = if extras.isolation == Isolation::Worktree {
            let Some(parent_dir) = req.working_dir.clone() else {
                return Err(Box::new(failed(
                    req.agent_type,
                    "isolation_unavailable",
                    "the parent has no working directory to make a worktree of".into(),
                )));
            };
            let location = match self.ledger() {
                Some(ledger) => ledger.worktree_location(req.parent_conversation_id).await,
                None => None,
            };
            let (label, fallback) = short_label();
            let wt = worktree::create(
                std::path::Path::new(&parent_dir),
                &label,
                &fallback,
                location.as_deref(),
            )
            .await
            .map_err(|e| Box::new(failed(req.agent_type, e.code(), e.message().to_string())))?;
            let working_dir = wt.working_dir.to_string_lossy().into_owned();
            if let Some(ledger) = self.ledger() {
                ledger
                    .register_worktree_folder(req.parent_conversation_id, &working_dir)
                    .await;
            }
            notes.push(format!(
                "It works in its own git worktree {} on branch {}, made from commit {} (the \
                 parent checkout's HEAD){}. Its changes stay there: review them and merge the \
                 branch yourself with git when it finishes, or leave that to the user.",
                wt.root.display(),
                wt.branch,
                worktree::short_sha(&wt.base_sha),
                if wt.parent_uncommitted > 0 {
                    format!(
                        "; your {} uncommitted change{} in the parent checkout {} not in it",
                        wt.parent_uncommitted,
                        if wt.parent_uncommitted == 1 { "" } else { "s" },
                        if wt.parent_uncommitted == 1 {
                            "is"
                        } else {
                            "are"
                        },
                    )
                } else {
                    String::new()
                }
            ));
            req.working_dir = Some(working_dir);
            Some(wt)
        } else {
            None
        };
        Ok(ForkLaunch {
            mode_id,
            config,
            extras,
            worktree,
            notes,
        })
    }

    /// A launch that ends before the child runs gives its worktree back.
    pub(super) async fn fork_abandon_launch(&self, launch: &ForkLaunch) {
        if let Some(wt) = &launch.worktree {
            worktree::remove(wt, true).await;
        }
    }

    /// After the spawn: does the child hold what the call asked for? An
    /// unavailable value stops the launch with the choices it has; an option
    /// it lacks is only noted.
    pub(super) async fn fork_check_launch(
        &self,
        child_connection_id: &str,
        agent_type: AgentType,
        launch: &mut ForkLaunch,
    ) -> Result<(), Box<DelegationTaskReport>> {
        let requested = launch.extras.requested_values();
        if requested.is_empty() {
            return Ok(());
        }
        let Some(options) = self.child_reported_options(child_connection_id).await else {
            return Ok(());
        };
        let result = fork_launch::check(&requested, &options);
        if !result.is_ok() {
            return Err(Box::new(failed(
                agent_type,
                "invalid_launch_option",
                result.rejection_message(),
            )));
        }
        if let Some(note) = result.unknown_note() {
            launch.notes.push(note);
        }
        Ok(())
    }

    /// The options a just-spawned child reports. It opens its session after
    /// the spawn returns, so wait for that (bounded, and not on a connection
    /// that went away); `None` when it never reported any — not checked.
    async fn child_reported_options(
        &self,
        child_connection_id: &str,
    ) -> Option<Vec<crate::acp::types::SessionConfigOptionInfo>> {
        let deadline = tokio::time::Instant::now() + SESSION_WAIT;
        let mut session_seen_at: Option<tokio::time::Instant> = None;
        loop {
            if let Some(options) = self.spawner.child_config_options(child_connection_id).await {
                return Some(options);
            }
            let now = tokio::time::Instant::now();
            if self
                .spawner
                .child_session_id(child_connection_id)
                .await
                .is_some()
            {
                // Session up: its options follow right behind, or never come
                // (an agent without any).
                let seen = *session_seen_at.get_or_insert(now);
                if now >= seen + OPTIONS_GRACE {
                    return None;
                }
            } else if !self.spawner.child_alive(child_connection_id).await {
                return None;
            }
            if now >= deadline {
                return None;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    /// The task id is minted: keep its launch facts for the meta writes and
    /// reports that follow.
    pub(super) fn fork_remember_launch(&self, call_id: &str, launch: &ForkLaunch) {
        self.put_fork_task(
            call_id,
            ForkTaskInfo {
                model: launch.extras.model.clone(),
                config: launch.extras.config.clone(),
                isolation: launch.extras.isolation,
                worktree: launch.worktree.as_ref().map(worktree_info),
                round: 1,
                notes: launch.notes.clone(),
            },
        );
    }

    /// Add the task's launch facts to the `codeg.delegation` meta the parent
    /// card reads (model, options, worktree, round).
    pub(super) fn fork_decorate_meta(&self, mut meta: Value) -> Value {
        let Some(inner) = meta
            .get_mut("codeg.delegation")
            .and_then(Value::as_object_mut)
        else {
            return meta;
        };
        let Some(task_id) = inner.get("task_id").and_then(Value::as_str) else {
            return meta;
        };
        let Some(info) = self.fork_task(task_id) else {
            return meta;
        };
        if let Some(model) = &info.model {
            inner.insert("model".into(), json!(model));
        }
        if !info.config.is_empty() {
            inner.insert("config".into(), json!(info.config));
        }
        if info.isolation != Isolation::Shared {
            inner.insert("isolation".into(), json!(info.isolation.as_str()));
        }
        if let Some(wt) = &info.worktree {
            inner.insert("worktree".into(), json!(wt));
        }
        if info.round > 1 {
            inner.insert("round".into(), json!(info.round));
        }
        meta
    }

    /// A resumed task launches as it first did — per-call options included,
    /// which the upstream recomputation from the assistant / settings drops.
    pub(super) async fn fork_resume_launch(
        &self,
        task_id: &str,
        mode_id: Option<String>,
        config: BTreeMap<String, String>,
    ) -> (Option<String>, BTreeMap<String, String>) {
        let Some(ledger) = self.ledger() else {
            return (mode_id, config);
        };
        let Some(row) = ledger.get(task_id).await else {
            return (mode_id, config);
        };
        if row.launch == LaunchRecord::default() {
            return (mode_id, config);
        }
        (row.launch.mode_id.or(mode_id), row.launch.config)
    }

    /// Say in a running ack how the task was launched (its worktree, an
    /// option this agent ignored).
    pub(super) fn fork_annotate_ack(&self, report: &mut DelegationTaskReport) {
        if report.status != TaskStatus::Running {
            return;
        }
        let Some(info) = report.task_id.as_deref().and_then(|id| self.fork_task(id)) else {
            return;
        };
        if info.notes.is_empty() {
            return;
        }
        let message = report.message.get_or_insert_with(String::new);
        for note in &info.notes {
            if !message.is_empty() {
                message.push(' ');
            }
            message.push_str(note);
        }
    }

    /// Say in a finished task's report where its work is (its worktree).
    pub(super) async fn fork_annotate_reports(&self, reports: &mut [DelegationTaskReport]) {
        for report in reports.iter_mut() {
            if !matches!(
                report.status,
                TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Canceled
            ) {
                continue;
            }
            let Some(task_id) = report.task_id.clone() else {
                continue;
            };
            let known = self.fork_task(&task_id).map(|info| info.worktree);
            let wt = match known {
                Some(wt) => wt,
                // After a restart: the ledger keeps where it was.
                None => match self.ledger() {
                    Some(ledger) => ledger.get(&task_id).await.and_then(|row| {
                        Some(DelegationWorktreeInfo {
                            path: row.worktree_path?,
                            branch: row.worktree_branch?,
                            base_sha: row.worktree_base_sha.unwrap_or_default(),
                            changes: None,
                        })
                    }),
                    None => None,
                },
            };
            let Some(wt) = wt else {
                continue;
            };
            let changes = worktree::changes(std::path::Path::new(&wt.path), &wt.base_sha).await;
            let note = format!(
                "Its work is in the git worktree {} on branch {} (from {}{}).",
                wt.path,
                wt.branch,
                worktree::short_sha(&wt.base_sha),
                changes.map(|c| format!(": {c}")).unwrap_or_default()
            );
            let message = report.message.get_or_insert_with(String::new);
            if !message.is_empty() {
                message.push(' ');
            }
            message.push_str(&note);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kept_launch_facts_are_bounded() {
        let mut tasks = ForkTasks::default();
        for i in 0..(KEPT + 10) {
            tasks.put(&format!("t{i}"), ForkTaskInfo::default());
        }
        assert!(tasks.get("t0").is_none());
        assert!(tasks.get(&format!("t{}", KEPT + 9)).is_some());
        assert_eq!(tasks.order.len(), KEPT);
    }
}
