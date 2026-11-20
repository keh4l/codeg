//! Periodic sweeper that disconnects ACP connections idle past a deadline.
//!
//! Connections accumulate when frontends close their window/tab without
//! triggering an explicit disconnect — common in web mode (browser tab
//! close has no server-side hook), and possible on desktop after panics.
//! The sweep prevents long-lived processes from leaking ACP child
//! processes, file handles, and memory.

use std::time::Duration;

use crate::acp::manager::ConnectionManager;

/// Default idle threshold for desktop mode (15 minutes). Override at startup via
/// `CODEG_ACP_IDLE_TIMEOUT_SECS`. The sweep only runs against connections in
/// `Connected` state with no `pending_permission`, and `last_activity_at` is
/// bumped on every emit and on every frontend keepalive touch (~30s cadence for
/// open tabs), so an actively-used or visible connection never qualifies.
/// 15 minutes gives enough headroom for backgrounded browser tabs or laptop
/// sleep without immediately forcing a cold agent respawn on return.
pub const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 900;
/// Default idle threshold for standalone `codeg-server` mode (30 minutes).
/// Remote web/mobile clients frequently lock screens or get throttled/frozen by
/// mobile browsers in the background, pausing the 30s keepalive. Keeping idle
/// agents warm for 30 minutes avoids constant cold reconnects when resuming
/// remote sessions. Still overridden by `CODEG_ACP_IDLE_TIMEOUT_SECS`.
pub const DEFAULT_SERVER_IDLE_TIMEOUT_SECS: u64 = 1800;
/// Sweep cadence — runs once per minute. Each tick is a brief lock on the
/// connections map plus per-state `try_read`s, so a 1-minute interval is
/// trivially cheap relative to the wall-clock idle threshold.
pub const SWEEP_INTERVAL_SECS: u64 = 60;

/// Read the idle timeout from `CODEG_ACP_IDLE_TIMEOUT_SECS`, falling back
/// to `default_secs`. A `0` value disables the sweep (returns `None`); any
/// unparseable value falls back to `default_secs`.
pub fn idle_timeout_from_env_with_default(default_secs: u64) -> Option<Duration> {
    let secs = match std::env::var("CODEG_ACP_IDLE_TIMEOUT_SECS") {
        Ok(raw) => raw.parse::<u64>().unwrap_or(default_secs),
        Err(_) => default_secs,
    };
    if secs == 0 {
        return None;
    }
    Some(Duration::from_secs(secs))
}

/// Read the idle timeout from `CODEG_ACP_IDLE_TIMEOUT_SECS`, falling back
/// to `DEFAULT_IDLE_TIMEOUT_SECS`. A `0` value disables the sweep
/// (returns `None`); any unparseable value is treated as "use default".
pub fn idle_timeout_from_env() -> Option<Duration> {
    idle_timeout_from_env_with_default(DEFAULT_IDLE_TIMEOUT_SECS)
}

/// Long-running task that calls `ConnectionManager::sweep_idle` on a
/// fixed interval. The caller spawns the returned future onto whichever
/// runtime they manage (`tokio::spawn` from inside an async context,
/// `tauri::async_runtime::spawn` from a Tauri `setup` callback that runs
/// outside the runtime).
///
/// Never exits on its own — the caller drops the spawned handle when
/// shutting down (process exit cleans up everything).
pub async fn idle_sweep_task(
    manager: ConnectionManager,
    idle_timeout: Duration,
    interval: Duration,
) {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // First `tick().await` returns immediately. Skip it so we don't
    // sweep at startup before any connections have a chance to settle.
    ticker.tick().await;
    loop {
        ticker.tick().await;
        let n = manager.sweep_idle(idle_timeout).await;
        if n > 0 {
            tracing::info!("[ACP] idle sweep disconnected {n} connection(s)");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Single test sequences all env-var assertions to avoid the
    /// notorious parallel-test race on shared environment state. Cargo
    /// runs tests in parallel by default; setting `CODEG_ACP_IDLE_TIMEOUT_SECS`
    /// in concurrent tests would interleave with each other.
    #[test]
    fn idle_timeout_env_parsing() {
        // Disabled when zero.
        std::env::set_var("CODEG_ACP_IDLE_TIMEOUT_SECS", "0");
        assert!(idle_timeout_from_env().is_none());

        // Falls back to default when unparseable.
        std::env::set_var("CODEG_ACP_IDLE_TIMEOUT_SECS", "not-a-number");
        assert_eq!(
            idle_timeout_from_env().unwrap().as_secs(),
            DEFAULT_IDLE_TIMEOUT_SECS
        );

        // Uses provided value when it parses.
        std::env::set_var("CODEG_ACP_IDLE_TIMEOUT_SECS", "120");
        assert_eq!(idle_timeout_from_env().unwrap().as_secs(), 120);

        // Falls back to default when unset.
        std::env::remove_var("CODEG_ACP_IDLE_TIMEOUT_SECS");
        assert_eq!(
            idle_timeout_from_env().unwrap().as_secs(),
            DEFAULT_IDLE_TIMEOUT_SECS
        );
        assert_eq!(
            idle_timeout_from_env_with_default(DEFAULT_SERVER_IDLE_TIMEOUT_SECS)
                .unwrap()
                .as_secs(),
            DEFAULT_SERVER_IDLE_TIMEOUT_SECS
        );
    }
}
