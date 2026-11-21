//! keh4l build: the broker's side of pushing results to the parent
//! (`crate::acp::delegation::delivery`). A child module of the broker so it
//! reads the pending maps directly while `broker.rs` only carries one-line
//! hooks.

use std::sync::Arc;

use super::{failure_is_resumable, CompletedTask, DelegationBroker, PendingInner, RunningTask};
use crate::acp::delegation::delivery::{DeliverySink, TerminalCause, TerminalEvent};
use crate::acp::delegation::notice::NoticeTask;
use crate::acp::delegation::types::{DelegationTaskReport, TaskStatus};

pub(super) const CHILD_FAILED: TerminalCause = TerminalCause::ChildFailed;
pub(super) const USER_CANCELED: TerminalCause = TerminalCause::UserCanceled;

fn status_wire(status: TaskStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "failed".to_string())
}

fn terminal_event(
    task_id: &str,
    task: &RunningTask,
    completed: &CompletedTask,
    cause: TerminalCause,
) -> TerminalEvent {
    let resumable = cause == TerminalCause::ChildFailed
        || completed
            .error_code
            .as_deref()
            .is_some_and(failure_is_resumable);
    let message = match cause {
        TerminalCause::UserCanceled => Some("Canceled by the user.".to_string()),
        _ => completed.message.clone(),
    };
    TerminalEvent {
        parent_connection_id: task.parent_connection_id.clone(),
        parent_conversation_id: task.parent_conversation_id,
        task: NoticeTask {
            task_id: task_id.to_string(),
            agent_type: task.agent_type.as_wire().into_owned(),
            assistant: task.assistant.as_ref().map(|a| a.name.clone()),
            status: status_wire(completed.status),
            duration_ms: completed.duration_ms,
            text: completed.text.clone(),
            truncated: false,
            error_code: completed.error_code.clone(),
            message,
            resumable,
            child_conversation_id: completed.child_conversation_id,
            worktree: None,
        },
        cause,
    }
}

impl DelegationBroker {
    /// Hand terminal results to `sink` from now on. A second call is ignored.
    pub fn install_delivery(&self, sink: Arc<dyn DeliverySink>) {
        let _ = self.delivery.set(sink);
    }

    /// A running task reached its end on its own (`complete_call`). Called
    /// with the pending lock held, before the result is queryable.
    pub(super) fn announce_finished(
        &self,
        task_id: &str,
        task: &RunningTask,
        completed: &CompletedTask,
    ) {
        let Some(sink) = self.delivery.get() else {
            return;
        };
        // A child that ends with `cancelled` was stopped by the user from its
        // own view: the parent agent hears about it, but is not woken for it.
        let cause = if completed.status == TaskStatus::Canceled {
            TerminalCause::UserCanceled
        } else {
            TerminalCause::Finished
        };
        sink.on_terminal(terminal_event(task_id, task, completed, cause));
    }

    /// Tasks just drained into `completed` (pending lock held).
    pub(super) fn announce_drained(
        &self,
        drained: &[(RunningTask, u64)],
        inner: &PendingInner,
        cause: TerminalCause,
    ) {
        let Some(sink) = self.delivery.get() else {
            return;
        };
        for (task, _) in drained {
            if let Some(completed) = inner.completed.get(&task.task_id) {
                sink.on_terminal(terminal_event(&task.task_id, task, completed, cause));
            }
        }
    }

    /// The parent agent is getting these reports: whatever terminal result
    /// they carry is not pushed again.
    pub(super) fn note_reports_consumed(&self, reports: &[DelegationTaskReport]) {
        let Some(sink) = self.delivery.get() else {
            return;
        };
        let ids: Vec<String> = reports
            .iter()
            .filter(|r| {
                matches!(
                    r.status,
                    TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Canceled
                )
            })
            .filter_map(|r| r.task_id.clone())
            .collect();
        sink.on_consumed(&ids);
    }

    /// The parent agent addressed this task itself (cancel / resume).
    pub(super) fn note_task_consumed(&self, task_id: &str) {
        if let Some(sink) = self.delivery.get() {
            sink.on_consumed(&[task_id.to_string()]);
        }
    }

    /// Ids of the delegations a parent conversation has running now.
    pub async fn running_task_ids_for_conversation(&self, conversation_id: i32) -> Vec<String> {
        let inner = self.pending.inner.lock().await;
        let mut running: Vec<(&std::time::Instant, String)> = inner
            .running
            .values()
            .filter(|t| t.parent_conversation_id == conversation_id)
            .map(|t| (&t.started_at, t.task_id.clone()))
            .collect();
        running.sort();
        running.into_iter().map(|(_, id)| id).collect()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex as StdMutex;

    use async_trait::async_trait;

    use super::*;
    use crate::acp::delegation::broker::{ConversationDepthLookup, DelegationConfig, StatusWait};
    use crate::acp::delegation::spawner::{mock::MockSpawner, ConnectionSpawner};
    use crate::acp::delegation::types::{
        DelegationError, DelegationOutcome, DelegationRequest, DelegationSuccess,
    };
    use crate::models::AgentType;

    struct RootDepth;

    #[async_trait]
    impl ConversationDepthLookup for RootDepth {
        async fn parent_of(&self, _id: i32) -> Result<Option<i32>, DelegationError> {
            Ok(None)
        }
    }

    #[derive(Default)]
    struct RecordingSink {
        terminals: StdMutex<Vec<TerminalEvent>>,
        consumed: StdMutex<Vec<String>>,
    }

    impl DeliverySink for RecordingSink {
        fn on_terminal(&self, event: TerminalEvent) {
            self.terminals.lock().unwrap().push(event);
        }
        fn on_consumed(&self, task_ids: &[String]) {
            self.consumed
                .lock()
                .unwrap()
                .extend(task_ids.iter().cloned());
        }
    }

    async fn broker_with_sink() -> (DelegationBroker, Arc<MockSpawner>, Arc<RecordingSink>) {
        let mock = Arc::new(MockSpawner::new());
        let broker = DelegationBroker::new(
            mock.clone() as Arc<dyn ConnectionSpawner>,
            Arc::new(RootDepth) as Arc<dyn ConversationDepthLookup>,
        );
        broker
            .set_config(DelegationConfig {
                enabled: true,
                ..DelegationConfig::default()
            })
            .await;
        let sink = Arc::new(RecordingSink::default());
        broker.install_delivery(sink.clone() as Arc<dyn DeliverySink>);
        (broker, mock, sink)
    }

    async fn start(broker: &DelegationBroker, mock: &MockSpawner, child: &str) -> String {
        mock.queue_spawn(Ok(child.into())).await;
        mock.queue_send(Ok(42)).await;
        broker
            .start_delegation(DelegationRequest {
                parent_connection_id: "parent-conn".into(),
                parent_conversation_id: 7,
                parent_tool_use_id: format!("tool-{child}"),
                agent_type: AgentType::Codex,
                task: "do x".into(),
                working_dir: None,
                requested_working_dir: None,
                external_handle: None,
                assistant: None,
            })
            .await
            .task_id
            .expect("running task carries an id")
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

    #[tokio::test]
    async fn a_finished_task_is_announced_for_its_parent_conversation() {
        let (broker, mock, sink) = broker_with_sink().await;
        let task_id = start(&broker, &mock, "child-1").await;
        assert_eq!(
            broker.running_task_ids_for_conversation(7).await,
            vec![task_id.clone()]
        );
        broker.complete_call(&task_id, ok("the answer")).await;
        let terminals = sink.terminals.lock().unwrap().clone();
        assert_eq!(terminals.len(), 1);
        let event = &terminals[0];
        assert_eq!(event.parent_conversation_id, 7);
        assert_eq!(event.parent_connection_id, "parent-conn");
        assert_eq!(event.cause, TerminalCause::Finished);
        assert_eq!(event.task.task_id, task_id);
        assert_eq!(event.task.status, "completed");
        assert_eq!(event.task.agent_type, "codex");
        assert_eq!(event.task.text.as_deref(), Some("the answer"));
        assert!(broker.running_task_ids_for_conversation(7).await.is_empty());
    }

    #[tokio::test]
    async fn polling_a_finished_task_marks_it_consumed() {
        let (broker, mock, sink) = broker_with_sink().await;
        let task_id = start(&broker, &mock, "child-1").await;
        // Still running: nothing is consumed.
        broker
            .get_tasks_status(
                "parent-conn",
                Some(7),
                std::slice::from_ref(&task_id),
                StatusWait::Immediate,
            )
            .await;
        assert!(sink.consumed.lock().unwrap().is_empty());
        broker.complete_call(&task_id, ok("done")).await;
        broker
            .get_tasks_status(
                "parent-conn",
                Some(7),
                std::slice::from_ref(&task_id),
                StatusWait::Immediate,
            )
            .await;
        assert_eq!(*sink.consumed.lock().unwrap(), vec![task_id]);
    }

    #[tokio::test]
    async fn a_dead_child_is_announced_as_resumable() {
        let (broker, mock, sink) = broker_with_sink().await;
        let task_id = start(&broker, &mock, "child-1").await;
        broker
            .cancel_by_child_connection("child-1", Some("transport closed"))
            .await;
        let terminals = sink.terminals.lock().unwrap().clone();
        assert_eq!(terminals.len(), 1);
        assert_eq!(terminals[0].task.task_id, task_id);
        assert_eq!(terminals[0].cause, TerminalCause::ChildFailed);
        assert!(terminals[0].task.resumable);
    }

    #[tokio::test]
    async fn stopping_the_parent_announces_user_cancels() {
        let (broker, mock, sink) = broker_with_sink().await;
        let a = start(&broker, &mock, "child-1").await;
        let b = start(&broker, &mock, "child-2").await;
        broker.cancel_by_parent_turn("parent-conn").await;
        let terminals = sink.terminals.lock().unwrap().clone();
        let mut ids: Vec<String> = terminals.iter().map(|e| e.task.task_id.clone()).collect();
        ids.sort();
        let mut want = vec![a, b];
        want.sort();
        assert_eq!(ids, want);
        assert!(terminals
            .iter()
            .all(|e| e.cause == TerminalCause::UserCanceled && e.task.status == "canceled"));
    }

    #[tokio::test]
    async fn canceling_a_task_marks_it_consumed() {
        let (broker, mock, sink) = broker_with_sink().await;
        let task_id = start(&broker, &mock, "child-1").await;
        broker
            .cancel_task_by_id("parent-conn", Some(7), &task_id)
            .await;
        assert_eq!(*sink.consumed.lock().unwrap(), vec![task_id]);
    }
}
