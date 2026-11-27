//! A cap on idle agents the user opened from a conversation view (fork).
//!
//! The web and desktop clients now park a connection when its view goes away
//! instead of disconnecting it, so switching back is instant. Each parked
//! agent is a live CLI process (~370 MB for an idle claude), and several
//! browsers, or an old client that never parks, can hold more than one
//! client's own budget. This keeps at most `max_idle` of them warm: past that,
//! the ones idle longest are disconnected, as the time-based sweep would do
//! later anyway.
//!
//! Only connections marked with [`ConnectionManager::mark_ui_session`] count —
//! the ones `acp_connect` spawned or reused for a conversation view.
//! Automation, CLI runs, one-shots, chat channels and delegation children keep
//! the time-based sweep alone. A connection is a candidate only when it is
//! `Connected` (no turn in flight), carries nothing a teardown would kill (the
//! sweep's own `teardown_blocker`), and nobody touched it for `hold_grace`:
//! an open tab touches its connection every 30 s, so tabs a client still shows
//! never count against the cap.
//!
//! Runs on the idle sweep's tick and right after a conversation view connects.
//! `CODEG_ACP_MAX_IDLE_CONNECTIONS` (default 6, `0` turns it off) and
//! `CODEG_ACP_IDLE_HOLD_GRACE_SECS` (default 90 — more than two keepalives,
//! which survives a background tab's timers throttled to once a minute).
//! Turning the idle sweep off (`CODEG_ACP_IDLE_TIMEOUT_SECS=0`) only leaves
//! the cap's after-connect run.

use std::sync::OnceLock;
use std::time::Duration;

use crate::acp::manager::ConnectionManager;
use crate::acp::types::ConnectionStatus;

pub const DEFAULT_MAX_IDLE_CONNECTIONS: usize = 6;
pub const DEFAULT_IDLE_HOLD_GRACE_SECS: u64 = 90;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdleCap {
    /// Idle UI connections kept warm; the rest are disconnected.
    pub max_idle: usize,
    /// How long a connection must go untouched before it counts as idle.
    pub hold_grace: Duration,
}

impl IdleCap {
    /// The cap from `CODEG_ACP_MAX_IDLE_CONNECTIONS` /
    /// `CODEG_ACP_IDLE_HOLD_GRACE_SECS`; `None` when turned off. A value that
    /// doesn't parse falls back to the default.
    pub fn from_env() -> Option<IdleCap> {
        Self::parse(
            std::env::var("CODEG_ACP_MAX_IDLE_CONNECTIONS")
                .ok()
                .as_deref(),
            std::env::var("CODEG_ACP_IDLE_HOLD_GRACE_SECS")
                .ok()
                .as_deref(),
        )
    }

    fn parse(max_idle: Option<&str>, hold_grace: Option<&str>) -> Option<IdleCap> {
        let max_idle = max_idle
            .and_then(|raw| raw.trim().parse::<usize>().ok())
            .unwrap_or(DEFAULT_MAX_IDLE_CONNECTIONS);
        if max_idle == 0 {
            return None;
        }
        let hold_grace = hold_grace
            .and_then(|raw| raw.trim().parse::<u64>().ok())
            .unwrap_or(DEFAULT_IDLE_HOLD_GRACE_SECS);
        Some(IdleCap {
            max_idle,
            hold_grace: Duration::from_secs(hold_grace),
        })
    }

    /// [`Self::from_env`], read once per process.
    pub fn configured() -> Option<IdleCap> {
        static CAP: OnceLock<Option<IdleCap>> = OnceLock::new();
        *CAP.get_or_init(Self::from_env)
    }
}

impl ConnectionManager {
    /// Count `conn_id` as a connection a conversation view opened, so the idle
    /// cap may end it once it has been idle long enough, then apply the cap in
    /// the background: the connect that just happened may have pushed the
    /// count past it.
    pub fn mark_ui_session(&self, conn_id: &str) {
        if let Ok(mut ids) = self.ui_connections.lock() {
            ids.insert(conn_id.to_string());
        }
        let Some(cap) = IdleCap::configured() else {
            return;
        };
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let manager = self.clone_ref();
            runtime.spawn(async move {
                manager.enforce_idle_cap(cap).await;
            });
        }
    }

    /// Apply the configured cap ([`IdleCap::configured`]); `0` when off.
    pub async fn enforce_configured_idle_cap(&self) -> usize {
        match IdleCap::configured() {
            Some(cap) => self.enforce_idle_cap(cap).await,
            None => 0,
        }
    }

    /// Disconnect the idle UI connections past `cap.max_idle`, the ones idle
    /// longest first. Returns how many were disconnected.
    pub async fn enforce_idle_cap(&self, cap: IdleCap) -> usize {
        let now = chrono::Utc::now();
        let Ok(grace) = chrono::Duration::from_std(cap.hold_grace) else {
            return 0;
        };
        let victims: Vec<String> = {
            let connections = self.connections.lock().await;
            let Ok(mut ui) = self.ui_connections.lock() else {
                return 0;
            };
            // Forget the ones that are gone, whoever ended them.
            ui.retain(|id| connections.contains_key(id));
            let mut idle = Vec::new();
            for id in ui.iter() {
                let Some(conn) = connections.get(id) else {
                    continue;
                };
                // A writer holds it: busy right now, look again next time.
                let Ok(state) = conn.state.try_read() else {
                    continue;
                };
                if state.status != ConnectionStatus::Connected {
                    continue;
                }
                if crate::acp::manager::teardown_blocker(&state, now, |child| {
                    connections.contains_key(child)
                })
                .is_some()
                {
                    continue;
                }
                if now.signed_duration_since(state.last_activity_at) < grace {
                    continue;
                }
                idle.push((state.last_activity_at, id.clone()));
            }
            if idle.len() <= cap.max_idle {
                return 0;
            }
            // Newest first; keep `max_idle` of them.
            idle.sort_by_key(|entry| std::cmp::Reverse(entry.0));
            idle.into_iter()
                .skip(cap.max_idle)
                .map(|(_, id)| id)
                .collect()
        };
        let mut disconnected = 0;
        for id in victims {
            tracing::info!(
                "[ACP] idle cap ({}) disconnecting connection={}",
                cap.max_idle,
                id
            );
            if self.disconnect(&id).await.is_ok() {
                disconnected += 1;
            }
            if let Ok(mut ui) = self.ui_connections.lock() {
                ui.remove(&id);
            }
        }
        disconnected
    }

    #[cfg(test)]
    fn is_ui_session(&self, conn_id: &str) -> bool {
        self.ui_connections
            .lock()
            .map(|ids| ids.contains(conn_id))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::agent::AgentType;
    use crate::web::event_bridge::EventEmitter;

    const CAP: IdleCap = IdleCap {
        max_idle: 2,
        hold_grace: Duration::from_secs(90),
    };

    async fn add(mgr: &ConnectionManager, id: &str, idle_secs: i64, ui: bool) {
        mgr.insert_test_connection(id, AgentType::ClaudeCode, None, EventEmitter::Noop)
            .await;
        let state = mgr.get_state(id).await.expect("connection exists");
        state.write().await.last_activity_at =
            chrono::Utc::now() - chrono::Duration::seconds(idle_secs);
        if ui {
            mgr.ui_connections.lock().unwrap().insert(id.to_string());
        }
    }

    async fn alive(mgr: &ConnectionManager, id: &str) -> bool {
        mgr.connections.lock().await.contains_key(id)
    }

    #[test]
    fn env_parsing() {
        let cap = IdleCap::parse(None, None).unwrap();
        assert_eq!(cap.max_idle, DEFAULT_MAX_IDLE_CONNECTIONS);
        assert_eq!(cap.hold_grace.as_secs(), DEFAULT_IDLE_HOLD_GRACE_SECS);
        assert!(IdleCap::parse(Some("0"), None).is_none());
        let cap = IdleCap::parse(Some(" 3 "), Some("30")).unwrap();
        assert_eq!((cap.max_idle, cap.hold_grace.as_secs()), (3, 30));
        let cap = IdleCap::parse(Some("lots"), Some("soon")).unwrap();
        assert_eq!(cap.max_idle, DEFAULT_MAX_IDLE_CONNECTIONS);
        assert_eq!(cap.hold_grace.as_secs(), DEFAULT_IDLE_HOLD_GRACE_SECS);
    }

    #[tokio::test]
    async fn keeps_the_newest_idle_ones() {
        let mgr = ConnectionManager::new();
        add(&mgr, "a", 1000, true).await;
        add(&mgr, "b", 500, true).await;
        add(&mgr, "c", 200, true).await;
        add(&mgr, "d", 100, true).await;

        assert_eq!(mgr.enforce_idle_cap(CAP).await, 2);
        assert!(!alive(&mgr, "a").await && !alive(&mgr, "b").await);
        assert!(alive(&mgr, "c").await && alive(&mgr, "d").await);
        // The ended ones are forgotten.
        assert!(!mgr.is_ui_session("a") && mgr.is_ui_session("c"));
        // At the cap: nothing more to do.
        assert_eq!(mgr.enforce_idle_cap(CAP).await, 0);
    }

    #[tokio::test]
    async fn open_tabs_and_other_connections_do_not_count() {
        let mgr = ConnectionManager::new();
        // Touched within the grace: a tab still shows it.
        add(&mgr, "shown1", 10, true).await;
        add(&mgr, "shown2", 30, true).await;
        add(&mgr, "shown3", 60, true).await;
        // Not opened from a view (automation, CLI, delegation child...).
        add(&mgr, "auto1", 5000, false).await;
        add(&mgr, "auto2", 5000, false).await;
        add(&mgr, "auto3", 5000, false).await;
        add(&mgr, "idle1", 1000, true).await;
        add(&mgr, "idle2", 500, true).await;

        assert_eq!(mgr.enforce_idle_cap(CAP).await, 0);
        for id in [
            "shown1", "shown2", "shown3", "auto1", "auto2", "auto3", "idle1", "idle2",
        ] {
            assert!(alive(&mgr, id).await, "{id} must stay");
        }
    }

    #[tokio::test]
    async fn spares_turns_and_pending_work() {
        let mgr = ConnectionManager::new();
        add(&mgr, "prompting", 1000, true).await;
        mgr.get_state("prompting")
            .await
            .unwrap()
            .write()
            .await
            .status = ConnectionStatus::Prompting;
        add(&mgr, "remote", 1000, true).await;
        mgr.get_state("remote")
            .await
            .unwrap()
            .write()
            .await
            .remote_control = Some(crate::acp::types::RemoteControlInfo {
            session_url: None,
            at_startup: false,
        });
        add(&mgr, "x", 900, true).await;
        add(&mgr, "y", 800, true).await;
        add(&mgr, "z", 700, true).await;

        assert_eq!(mgr.enforce_idle_cap(CAP).await, 1);
        assert!(alive(&mgr, "prompting").await && alive(&mgr, "remote").await);
        assert!(!alive(&mgr, "x").await);
        assert!(alive(&mgr, "y").await && alive(&mgr, "z").await);
    }

    #[tokio::test]
    async fn marking_counts_a_connection() {
        let mgr = ConnectionManager::new();
        mgr.insert_test_connection("v", AgentType::ClaudeCode, None, EventEmitter::Noop)
            .await;
        assert!(!mgr.is_ui_session("v"));
        mgr.mark_ui_session("v");
        assert!(mgr.is_ui_session("v"));
    }
}
