//! keh4l build: the "wake the parent agent when a delegation finishes" switch
//! (`crate::acp::delegation::delivery`), as Tauri commands. The web handlers
//! in `web::handlers::delegation_push` call the same cores.

use crate::acp::delegation::delivery::{self, DelegationPushSettings};
use crate::app_error::AppCommandError;
#[cfg(feature = "tauri-runtime")]
use crate::web::event_bridge::EventEmitter;

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_delegation_push_settings() -> Result<DelegationPushSettings, AppCommandError> {
    Ok(delivery::get_settings())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn set_delegation_push_settings(
    #[cfg(feature = "tauri-runtime")] app: tauri::AppHandle,
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
    settings: DelegationPushSettings,
) -> Result<DelegationPushSettings, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        delivery::set_settings_core(&db.conn, &EventEmitter::from_app(&app), settings).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = settings;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}
