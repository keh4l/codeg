//! Work a standalone server does once at start, so the first client does not
//! wait for it (fork).

use std::sync::Arc;

use crate::app_state::AppState;

/// The agents list. Its first computation resolves every agent's command and
/// asks system installs for their versions (3.2 s measured), filling the
/// caches every later one answers from (60 ms). Without this the first page
/// load after a start — after every upgrade — waited for it, and a new
/// conversation's composer with it.
pub fn spawn(state: Arc<AppState>) {
    tokio::spawn(async move {
        let started = std::time::Instant::now();
        match crate::commands::acp::acp_list_agents_core(&state.db).await {
            Ok(list) => tracing::info!(
                "[warm-up] agents list ready: {} agents in {} ms",
                list.len(),
                started.elapsed().as_millis()
            ),
            Err(e) => tracing::warn!("[warm-up] agents list failed: {e}"),
        }
    });
}
