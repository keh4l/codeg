//! keh4l build: the worktrees `delegate_to_agent` made with
//! `isolation: "worktree"` (`crate::acp::delegation::worktree`), as the
//! delegation card and the delete-conversation dialog see them: where one is,
//! what changed there, and removing it. Nothing removes one on its own.

use serde::{Deserialize, Serialize};

use crate::acp::delegation::worktree;
use crate::app_error::AppCommandError;
use crate::db::entities::delegation_task;
use crate::db::service::{conversation_service, delegation_task_service};
use crate::db::AppDatabase;
use crate::web::event_bridge::EventEmitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelegationWorktreeState {
    pub task_id: String,
    pub path: String,
    pub branch: String,
    pub base_sha: String,
    /// The directory is still there.
    pub exists: bool,
    /// Removed through Codeg.
    pub removed: bool,
    /// "3 files changed, 1 commit, 1 uncommitted".
    pub changes: Option<String>,
    /// Uncommitted entries in it now.
    pub uncommitted: usize,
    /// Where the child started in it (a subdirectory when the parent was in
    /// one) — the folder Codeg registered for it.
    pub working_dir: Option<String>,
    /// The parent conversation's folder: the project it belongs to.
    pub source_folder_id: i32,
}

async fn state_of(
    db: &AppDatabase,
    row: delegation_task::Model,
) -> Option<DelegationWorktreeState> {
    let path = row.worktree_path.clone()?;
    let branch = row.worktree_branch.clone()?;
    let base_sha = row.worktree_base_sha.clone().unwrap_or_default();
    let root = std::path::Path::new(&path);
    let exists = root.is_dir();
    let changes = if exists {
        worktree::changes(root, &base_sha).await
    } else {
        None
    };
    let uncommitted = if exists {
        crate::process::tokio_command("git")
            .arg("-C")
            .arg(root)
            .args(["status", "--porcelain"])
            .output()
            .await
            .ok()
            .filter(|o| o.status.success())
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .count()
            })
            .unwrap_or(0)
    } else {
        0
    };
    let source_folder_id = conversation_service::get_by_id(&db.conn, row.parent_conversation_id)
        .await
        .map(|c| c.folder_id)
        .unwrap_or(0);
    Some(DelegationWorktreeState {
        working_dir: row.working_dir.clone(),
        source_folder_id,
        task_id: row.task_id,
        path,
        branch,
        base_sha,
        exists,
        removed: row.worktree_removed_at.is_some(),
        changes,
        uncommitted,
    })
}

fn not_found() -> AppCommandError {
    AppCommandError::not_found("this delegation made no worktree")
}

pub async fn get_delegation_worktree_core(
    db: &AppDatabase,
    task_id: &str,
) -> Result<Option<DelegationWorktreeState>, AppCommandError> {
    let Some(row) = delegation_task_service::get(&db.conn, task_id).await? else {
        return Ok(None);
    };
    Ok(state_of(db, row).await)
}

/// The worktree a delegation made that `conversation_id` (its child) works
/// in, if any is still there.
pub async fn delegation_worktree_for_conversation_core(
    db: &AppDatabase,
    conversation_id: i32,
) -> Result<Option<DelegationWorktreeState>, AppCommandError> {
    let rows = delegation_task_service::rounds_of_child(&db.conn, conversation_id).await?;
    for row in rows {
        if row.worktree_path.is_some() && row.worktree_removed_at.is_none() {
            if let Some(state) = state_of(db, row).await {
                if state.exists {
                    return Ok(Some(state));
                }
            }
        }
    }
    Ok(None)
}

/// Remove a delegation's worktree (and its branch when `delete_branch`),
/// moving the conversations filed under it back to the project folder. A
/// worktree with a session still running in it is refused.
pub async fn remove_delegation_worktree_core(
    emitter: &EventEmitter,
    db: &AppDatabase,
    task_id: &str,
    delete_branch: bool,
    force: bool,
) -> Result<crate::commands::folders::GitWorktreeRemoval, AppCommandError> {
    let row = delegation_task_service::get(&db.conn, task_id)
        .await?
        .ok_or_else(not_found)?;
    let (Some(repo), Some(branch), Some(path)) = (
        row.worktree_repo.clone(),
        row.worktree_branch.clone(),
        row.worktree_path.clone(),
    ) else {
        return Err(not_found());
    };
    let source_folder_id = conversation_service::get_by_id(&db.conn, row.parent_conversation_id)
        .await
        .map(|c| c.folder_id)
        .unwrap_or(0);
    let removal = crate::commands::folders::git_remove_worktree_core(
        emitter,
        db,
        repo,
        branch,
        source_folder_id,
        delete_branch,
        force,
    )
    .await?;
    delegation_task_service::mark_worktree_removed(&db.conn, &path).await?;
    Ok(removal)
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_delegation_worktree(
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, AppDatabase>,
    task_id: String,
) -> Result<Option<DelegationWorktreeState>, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        get_delegation_worktree_core(&db, &task_id).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = task_id;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn delegation_worktree_for_conversation(
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, AppDatabase>,
    conversation_id: i32,
) -> Result<Option<DelegationWorktreeState>, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        delegation_worktree_for_conversation_core(&db, conversation_id).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = conversation_id;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn remove_delegation_worktree(
    #[cfg(feature = "tauri-runtime")] app: tauri::AppHandle,
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, AppDatabase>,
    task_id: String,
    delete_branch: bool,
    force: Option<bool>,
) -> Result<crate::commands::folders::GitWorktreeRemoval, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        remove_delegation_worktree_core(
            &EventEmitter::from_app(&app),
            &db,
            &task_id,
            delete_branch,
            force.unwrap_or(false),
        )
        .await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = (task_id, delete_branch, force);
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}
