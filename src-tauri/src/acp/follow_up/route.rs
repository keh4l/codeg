//! keh4l build: where a steer goes — the decision alone, kept pure for tests.
//!
//! T3 Code's order: the agent's native steering, else interrupt-and-restart,
//! else the queue. Grok is the one agent here whose cancel takes its running
//! foreground tool down with it, so it never restarts (T3:
//! `supportsSteeringByInterruptRestart: false`).

use crate::models::agent::AgentType;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SteerContext {
    /// A turn is in flight on the connection.
    pub running: bool,
    /// The agent is compacting its context: a steer would cut into that, so
    /// it waits for the turn instead (T3: `compactionBlocksSteering`).
    pub compacting: bool,
    /// `native_steering_available` on the connection.
    pub native: bool,
    /// The native wire takes these blocks (Kiro is text only).
    pub native_accepts: bool,
    pub agent_type: AgentType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SteerRoute {
    /// Nothing to steer: send it as an ordinary prompt.
    NotRunning,
    Native,
    Restart,
    Queue,
}

/// Whether cutting this agent's turn off is safe enough to steer with.
pub fn restart_allowed(agent_type: AgentType) -> bool {
    !matches!(agent_type, AgentType::Grok)
}

pub fn route_steer(ctx: SteerContext) -> SteerRoute {
    if !ctx.running {
        return SteerRoute::NotRunning;
    }
    if ctx.compacting {
        return SteerRoute::Queue;
    }
    if ctx.native && ctx.native_accepts {
        return SteerRoute::Native;
    }
    if restart_allowed(ctx.agent_type) {
        return SteerRoute::Restart;
    }
    SteerRoute::Queue
}

/// The `_meta` codeg puts on a context-compaction tool call (`contextCompaction:
/// true` or `{version >= 1}`; the frontend's `isContextCompactionMeta`).
pub fn is_compaction_meta(meta: Option<&serde_json::Value>) -> bool {
    match meta.and_then(|m| m.get("contextCompaction")) {
        Some(serde_json::Value::Bool(true)) => true,
        Some(serde_json::Value::Object(marker)) => marker
            .get("version")
            .and_then(serde_json::Value::as_i64)
            .is_some_and(|v| v >= 1),
        _ => false,
    }
}

/// What to do with the queue when a turn ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnEndAction {
    /// Send the next queued message.
    Flush,
    /// Keep the queue but stop sending until the user lets it go.
    Hold,
    /// The turn was cut off by a steer restart: leave the queue alone.
    Ignore,
}

/// `queued_after_stop`: a message was queued after the user pressed stop, so
/// the stop has already been answered with "send this next".
pub fn on_turn_end(stop_reason: &str, restart: bool, queued_after_stop: bool) -> TurnEndAction {
    if restart {
        return TurnEndAction::Ignore;
    }
    match stop_reason {
        "end_turn" => TurnEndAction::Flush,
        "cancelled" if queued_after_stop => TurnEndAction::Flush,
        _ => TurnEndAction::Hold,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(
        running: bool,
        native: bool,
        native_accepts: bool,
        agent_type: AgentType,
    ) -> SteerContext {
        SteerContext {
            running,
            compacting: false,
            native,
            native_accepts,
            agent_type,
        }
    }

    #[test]
    fn native_first_then_restart_then_queue() {
        assert_eq!(
            route_steer(ctx(false, true, true, AgentType::ClaudeCode)),
            SteerRoute::NotRunning
        );
        assert_eq!(
            route_steer(ctx(true, true, true, AgentType::ClaudeCode)),
            SteerRoute::Native
        );
        assert_eq!(
            route_steer(ctx(true, false, true, AgentType::Gemini)),
            SteerRoute::Restart
        );
        // Kiro with an image: its wire is text only.
        assert_eq!(
            route_steer(ctx(true, true, false, AgentType::Kiro)),
            SteerRoute::Restart
        );
        // Grok without a working interject never restarts.
        assert_eq!(
            route_steer(ctx(true, false, true, AgentType::Grok)),
            SteerRoute::Queue
        );
        // Compacting: wait for the turn, whatever the agent could do.
        let mut compacting = ctx(true, true, true, AgentType::ClaudeCode);
        compacting.compacting = true;
        assert_eq!(route_steer(compacting), SteerRoute::Queue);
    }

    #[test]
    fn compaction_calls_are_recognized_by_meta() {
        assert!(is_compaction_meta(Some(
            &serde_json::json!({"contextCompaction": true})
        )));
        assert!(is_compaction_meta(Some(
            &serde_json::json!({"contextCompaction": {"version": 1}})
        )));
        assert!(!is_compaction_meta(Some(
            &serde_json::json!({"contextCompaction": {"version": 0}})
        )));
        assert!(!is_compaction_meta(Some(
            &serde_json::json!({"other": true})
        )));
        assert!(!is_compaction_meta(None));
    }

    #[test]
    fn turn_end_decides_the_queue() {
        assert_eq!(on_turn_end("end_turn", false, false), TurnEndAction::Flush);
        assert_eq!(on_turn_end("cancelled", false, false), TurnEndAction::Hold);
        assert_eq!(on_turn_end("cancelled", false, true), TurnEndAction::Flush);
        assert_eq!(on_turn_end("cancelled", true, false), TurnEndAction::Ignore);
        assert_eq!(on_turn_end("refusal", false, true), TurnEndAction::Hold);
        assert_eq!(on_turn_end("max_tokens", false, false), TurnEndAction::Hold);
        assert_eq!(on_turn_end("empty", false, false), TurnEndAction::Hold);
    }
}
