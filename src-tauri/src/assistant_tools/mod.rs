//! `create_assistant` / `update_assistant`: the codeg-mcp tools the keh4l build
//! adds so an agent can set up the user's @-mentionable assistants from the
//! conversation, instead of walking them through the editor field by field.
//!
//! An assistant is a delegation preset (see `crate::models::assistant`): a
//! name, an agent with EVERY option it advertises picked explicitly, and
//! standing instructions. The editor gets those options by probing the agent;
//! these tools do the same (`acp_describe_agent_options_core`), take the picks
//! the call names — by id or by the name the agent shows — and leave every
//! other option at the assistant's current pick (an update) or the agent's own
//! default (the value the editor marks "recommended"). The write goes through
//! `assistant_create_core` / `assistant_update_core`, so every client's mention
//! list and settings page update from the same broadcast as an editor save.
//!
//! - [`selection`]: matching the requested picks against a probe snapshot —
//!   pure, so it is tested without launching an agent.
//! - [`mcp`]: the tool calls themselves, as the delegation listener hands them
//!   over.
//!
//! The switch ("create assistants" under Settings → Agent tools, the
//! `assistants` tool group) is ON unless the user turns it off: unlike the
//! upstream authoring tools, an assistant runs nothing by itself.

pub mod mcp;
pub mod selection;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use sea_orm::DatabaseConnection;

use crate::acp::manager::ConnectionManager;
use crate::app_error::AppCommandError;
use crate::db::service::app_metadata_service;
use crate::db::AppDatabase;
use crate::web::event_bridge::{emit_event, EventEmitter};

/// The tools this module serves, as the companion names them.
pub const TOOL_NAMES: [&str; 2] = ["create_assistant", "update_assistant"];

/// `app_metadata` key of the switch.
const ENABLED_KEY: &str = "assistant_tools.enabled";

/// Broadcast after the switch changes, carrying [`AssistantToolsSettings`], so
/// every open settings page follows a toggle made elsewhere.
pub const SETTINGS_CHANGED_EVENT: &str = "assistant-tools-settings://changed";

static ENABLED: AtomicBool = AtomicBool::new(true);

/// What the parent process lends the tools: set once at startup, before the
/// listener takes a call.
pub struct Runtime {
    pub db: Arc<AppDatabase>,
    pub emitter: EventEmitter,
    pub manager: Arc<ConnectionManager>,
    /// The data directory agent launches resolve their runtime env against.
    pub data_dir: PathBuf,
}

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

/// Hand the tools their handles. A second call is ignored.
pub fn install(runtime: Runtime) {
    let _ = RUNTIME.set(runtime);
}

pub(crate) fn runtime() -> Option<&'static Runtime> {
    RUNTIME.get()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AssistantToolsSettings {
    pub enabled: bool,
}

/// Whether to offer the tools to an agent being launched (and to accept a
/// call from one already running).
pub fn is_enabled() -> bool {
    #[cfg(test)]
    if let Some(forced) = THREAD_OVERRIDE.with(std::cell::Cell::get) {
        return forced;
    }
    ENABLED.load(Ordering::Relaxed)
}

#[cfg(test)]
thread_local! {
    static THREAD_OVERRIDE: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// For a test that needs every codeg-mcp group off (the switch is on by
/// default and process-wide): the tools read as off on the calling thread —
/// a `#[tokio::test]`'s own — until the guard drops, and nowhere else.
#[cfg(test)]
pub(crate) fn off_on_this_thread() -> ThreadOverride {
    THREAD_OVERRIDE.with(|o| o.set(Some(false)));
    ThreadOverride
}

#[cfg(test)]
pub(crate) struct ThreadOverride;

#[cfg(test)]
impl Drop for ThreadOverride {
    fn drop(&mut self) {
        THREAD_OVERRIDE.with(|o| o.set(None));
    }
}

/// Read the stored switch into the runtime flag. Anything but a stored
/// `"false"` leaves it on.
pub async fn apply_persisted_settings(conn: &DatabaseConnection) {
    let enabled = match app_metadata_service::get_value(conn, ENABLED_KEY).await {
        Ok(Some(raw)) => raw.trim() != "false",
        Ok(None) => true,
        Err(e) => {
            tracing::warn!("[assistant-tools] reading the switch failed ({e}); keeping it on");
            true
        }
    };
    ENABLED.store(enabled, Ordering::Relaxed);
}

/// Store the switch, apply it, and tell every client.
pub async fn set_enabled_core(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    enabled: bool,
) -> Result<AssistantToolsSettings, AppCommandError> {
    app_metadata_service::upsert_value(conn, ENABLED_KEY, &enabled.to_string()).await?;
    ENABLED.store(enabled, Ordering::Relaxed);
    let settings = AssistantToolsSettings { enabled };
    emit_event(emitter, SETTINGS_CHANGED_EVENT, settings);
    Ok(settings)
}

/// The palette colour a new assistant's avatar gets from its name — the
/// editor's `colorForName` (`src/lib/assistant-avatar.ts`), so an assistant
/// made here looks like one made there.
pub(crate) fn color_for_name(name: &str) -> &'static str {
    let palette = crate::models::assistant::ASSISTANT_AVATAR_COLORS;
    let mut hash: u32 = 0;
    for ch in name.trim().to_lowercase().chars() {
        hash = hash.wrapping_mul(31).wrapping_add(ch as u32);
    }
    palette[hash as usize % palette.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Same colours as the editor: values computed with `colorForName` in
    /// `src/lib/assistant-avatar.ts`.
    #[test]
    fn avatar_colours_match_the_editor() {
        assert_eq!(color_for_name("Reviewer"), "blue");
        assert_eq!(color_for_name("  reviewer "), "blue");
        assert_eq!(color_for_name("审查员"), "sky");
        assert_eq!(color_for_name(""), "slate");
    }

    #[test]
    fn a_thread_override_is_scoped_to_its_guard() {
        {
            let _off = off_on_this_thread();
            assert!(!is_enabled());
            let elsewhere = std::thread::spawn(|| THREAD_OVERRIDE.with(std::cell::Cell::get));
            assert_eq!(elsewhere.join().unwrap(), None, "other threads unaffected");
        }
        assert_eq!(THREAD_OVERRIDE.with(std::cell::Cell::get), None);
    }

    #[tokio::test]
    async fn the_switch_defaults_on_and_persists() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        apply_persisted_settings(&db.conn).await;
        assert!(is_enabled());
        let set = set_enabled_core(&db.conn, &EventEmitter::Noop, false)
            .await
            .unwrap();
        assert!(!set.enabled && !is_enabled());
        ENABLED.store(true, Ordering::Relaxed);
        apply_persisted_settings(&db.conn).await;
        assert!(!is_enabled(), "a stored off survives a restart");
        set_enabled_core(&db.conn, &EventEmitter::Noop, true)
            .await
            .unwrap();
        assert!(is_enabled());
    }
}
