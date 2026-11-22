//! keh4l build: steering by interrupt-and-restart.
//!
//! An agent with no native steering is steered by cancelling the running turn
//! and sending the message as the next prompt of the same session (T3 Code's
//! `restart_active`). That cancel is not the user's stop, so while a restart is
//! under way:
//!
//! - the conversation loop's cancel leaves delegated sub-agents running
//!   ([`cancel_is_restart`], checked at the top of both `Cancel` arms in
//!   `connection.rs`);
//! - the delegation push does not pause (`delegation::delivery`);
//! - the follow-up queue is not held (`super::Engine::on_turn_complete`);
//!   both ask [`turn_end_is_restart`].
//!
//! The registry walks `Cancelling → Sending → Done` per connection. `Done`
//! lingers for [`DONE_GRACE`] so a bus consumer that reads the cancelled
//! `TurnComplete` a little late still recognises it — only a cancelled one:
//! the steered turn's own end is a turn end like any other, however soon it
//! comes. A stop by the user clears the entry ([`stop`]), so that stop is
//! the user's again everywhere.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::acp::types::PromptInputBlock;

pub const DONE_GRACE: Duration = Duration::from_secs(10);

/// A steer waiting for its turn to be cut off.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingRestart {
    pub steer_id: String,
    pub conversation_id: Option<i32>,
    pub text: String,
    pub blocks: Vec<PromptInputBlock>,
}

#[derive(Debug)]
enum Phase {
    Cancelling(PendingRestart),
    Sending,
    Done(Instant),
}

fn registry() -> &'static Mutex<HashMap<String, Phase>> {
    static REG: OnceLock<Mutex<HashMap<String, Phase>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn with<R>(f: impl FnOnce(&mut HashMap<String, Phase>) -> R) -> R {
    let mut map = registry().lock().unwrap_or_else(|e| e.into_inner());
    f(&mut map)
}

/// What [`begin`] did.
#[derive(Debug, PartialEq)]
pub enum Begin {
    /// A new restart: the caller cancels the turn and runs the send.
    Started,
    /// A restart was already cutting this turn off; the steer joined it.
    Joined,
    /// The previous restart's prompt is on its way; steer the new turn instead.
    Busy,
}

/// Start (or join) a restart on `conn_id`.
pub fn begin(conn_id: &str, pending: PendingRestart) -> Begin {
    with(|map| match map.get_mut(conn_id) {
        Some(Phase::Cancelling(existing)) => {
            if !existing.text.is_empty() && !pending.text.is_empty() {
                existing.text.push_str("\n\n");
            }
            existing.text.push_str(&pending.text);
            if !existing.blocks.is_empty() {
                existing.blocks.push(PromptInputBlock::Text {
                    text: "\n\n".into(),
                });
            }
            existing.blocks.extend(pending.blocks);
            Begin::Joined
        }
        Some(Phase::Sending) => Begin::Busy,
        _ => {
            map.insert(conn_id.to_string(), Phase::Cancelling(pending));
            Begin::Started
        }
    })
}

/// Whether the cancel the conversation loop is handling now is a steer
/// restart's. The restart sends its cancel while `Cancelling`, and its prompt
/// queues behind that cancel, so the loop never reads it later than `Sending`.
pub fn cancel_is_restart(conn_id: &str) -> bool {
    with(|map| {
        matches!(
            map.get(conn_id),
            Some(Phase::Cancelling(_)) | Some(Phase::Sending)
        )
    })
}

/// Whether a turn end on `conn_id` is the one a steer restart cut off.
pub fn turn_end_is_restart(conn_id: &str, stop_reason: &str) -> bool {
    if stop_reason != "cancelled" {
        return false;
    }
    with(|map| match map.get(conn_id) {
        Some(Phase::Cancelling(_)) | Some(Phase::Sending) => true,
        Some(Phase::Done(at)) => at.elapsed() < DONE_GRACE,
        None => false,
    })
}

/// The steer still waiting to be sent, if any (for the composer and tests).
pub fn pending(conn_id: &str) -> Option<PendingRestart> {
    with(|map| match map.get(conn_id) {
        Some(Phase::Cancelling(p)) => Some(p.clone()),
        _ => None,
    })
}

/// The user stopped the turn (or the connection went away). Whatever restart
/// was under way stops counting, so this stop is the user's; a steer still
/// waiting for its turn to end is not sent and comes back.
pub fn stop(conn_id: &str) -> Option<PendingRestart> {
    with(|map| match map.remove(conn_id) {
        Some(Phase::Cancelling(p)) => Some(p),
        _ => None,
    })
}

/// The turn is over: take the steer to send it.
pub fn take_for_send(conn_id: &str) -> Option<PendingRestart> {
    with(|map| match map.remove(conn_id) {
        Some(Phase::Cancelling(p)) => {
            map.insert(conn_id.to_string(), Phase::Sending);
            Some(p)
        }
        Some(other) => {
            map.insert(conn_id.to_string(), other);
            None
        }
        None => None,
    })
}

/// The restart's prompt went out (or gave up). A user stop in the meantime
/// already cleared the entry, and it stays cleared.
pub fn finish(conn_id: &str) {
    with(|map| {
        if matches!(map.get(conn_id), Some(Phase::Sending)) {
            map.insert(conn_id.to_string(), Phase::Done(Instant::now()));
        }
        map.retain(|_, phase| !matches!(phase, Phase::Done(at) if at.elapsed() >= DONE_GRACE));
    })
}

/// Forget a connection entirely (it went away).
pub fn forget(conn_id: &str) {
    with(|map| {
        map.remove(conn_id);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn steer(id: &str, text: &str) -> PendingRestart {
        PendingRestart {
            steer_id: id.into(),
            conversation_id: Some(1),
            text: text.into(),
            blocks: vec![PromptInputBlock::Text { text: text.into() }],
        }
    }

    #[test]
    fn walks_cancelling_sending_done() {
        let c = "restart-walk";
        assert!(!cancel_is_restart(c));
        assert!(!turn_end_is_restart(c, "cancelled"));
        assert_eq!(begin(c, steer("s1", "use env.ts")), Begin::Started);
        assert!(cancel_is_restart(c));
        assert!(turn_end_is_restart(c, "cancelled"));
        assert_eq!(pending(c).unwrap().steer_id, "s1");
        let taken = take_for_send(c).unwrap();
        assert_eq!(taken.text, "use env.ts");
        assert!(
            cancel_is_restart(c),
            "still a restart while its prompt goes out"
        );
        assert_eq!(begin(c, steer("s2", "x")), Begin::Busy);
        finish(c);
        assert!(
            turn_end_is_restart(c, "cancelled"),
            "a late reader still sees the cut-off turn end"
        );
        assert!(!cancel_is_restart(c), "a cancel now is the user's");
        assert_eq!(begin(c, steer("s3", "y")), Begin::Started);
        forget(c);
        assert!(!cancel_is_restart(c));
        assert!(!turn_end_is_restart(c, "cancelled"));
    }

    #[test]
    fn the_steered_turn_ends_like_any_other() {
        let c = "restart-steered-end";
        begin(c, steer("s1", "use env.ts"));
        assert!(!turn_end_is_restart(c, "end_turn"));
        take_for_send(c);
        finish(c);
        // A quick reply ends well within the grace.
        assert!(!turn_end_is_restart(c, "end_turn"));
        assert!(!turn_end_is_restart(c, "max_tokens"));
        forget(c);
    }

    #[test]
    fn a_user_stop_after_the_send_is_the_users() {
        let c = "restart-user-stop";
        begin(c, steer("s1", "use env.ts"));
        take_for_send(c);
        // Stopped while the steer's prompt was going out.
        assert!(stop(c).is_none());
        finish(c);
        assert!(!cancel_is_restart(c));
        assert!(!turn_end_is_restart(c, "cancelled"));
        // Stopped during the grace.
        begin(c, steer("s2", "again"));
        take_for_send(c);
        finish(c);
        assert!(stop(c).is_none());
        assert!(!turn_end_is_restart(c, "cancelled"));
    }

    #[test]
    fn a_second_steer_joins_the_first() {
        let c = "restart-join";
        begin(c, steer("s1", "first"));
        assert_eq!(begin(c, steer("s2", "second")), Begin::Joined);
        let p = take_for_send(c).unwrap();
        assert_eq!(p.steer_id, "s1");
        assert_eq!(p.text, "first\n\nsecond");
        assert_eq!(p.blocks.len(), 3);
        forget(c);
    }

    #[test]
    fn a_stop_takes_the_steer_back() {
        let c = "restart-abort";
        begin(c, steer("s1", "first"));
        assert_eq!(stop(c).unwrap().steer_id, "s1");
        assert!(!cancel_is_restart(c));
        assert!(take_for_send(c).is_none());
        // Too late once it is being sent.
        begin(c, steer("s2", "again"));
        take_for_send(c);
        assert!(stop(c).is_none());
        forget(c);
    }
}
