//! keh4l build: reads and writes of the `delegation_task` ledger. See
//! `crate::acp::delegation::ledger`.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
};

use crate::db::entities::delegation_task;
use crate::db::error::DbError;

pub async fn insert(
    conn: &DatabaseConnection,
    row: delegation_task::ActiveModel,
) -> Result<(), DbError> {
    delegation_task::Entity::insert(row).exec(conn).await?;
    Ok(())
}

pub async fn get(
    conn: &DatabaseConnection,
    task_id: &str,
) -> Result<Option<delegation_task::Model>, DbError> {
    Ok(delegation_task::Entity::find_by_id(task_id.to_string())
        .one(conn)
        .await?)
}

/// The round that continued `task_id`, if any.
pub async fn successor_of(
    conn: &DatabaseConnection,
    task_id: &str,
) -> Result<Option<delegation_task::Model>, DbError> {
    Ok(delegation_task::Entity::find()
        .filter(delegation_task::Column::SourceTaskId.eq(task_id))
        .one(conn)
        .await?)
}

/// Every round run in the child conversation, oldest first.
pub async fn rounds_of_child(
    conn: &DatabaseConnection,
    child_conversation_id: i32,
) -> Result<Vec<delegation_task::Model>, DbError> {
    Ok(delegation_task::Entity::find()
        .filter(delegation_task::Column::ChildConversationId.eq(child_conversation_id))
        .order_by_asc(delegation_task::Column::Round)
        .all(conn)
        .await?)
}

pub async fn set_child_conversation(
    conn: &DatabaseConnection,
    task_id: &str,
    child_conversation_id: i32,
) -> Result<(), DbError> {
    if let Some(row) = get(conn, task_id).await? {
        let mut active: delegation_task::ActiveModel = row.into();
        active.child_conversation_id = Set(Some(child_conversation_id));
        active.update(conn).await?;
    }
    Ok(())
}

pub async fn finish(
    conn: &DatabaseConnection,
    task_id: &str,
    status: &str,
    error_code: Option<String>,
    duration_ms: u64,
    result_preview: Option<String>,
) -> Result<(), DbError> {
    if let Some(row) = get(conn, task_id).await? {
        let mut active: delegation_task::ActiveModel = row.into();
        active.status = Set(status.to_string());
        active.error_code = Set(error_code);
        active.duration_ms = Set(Some(duration_ms.min(i64::MAX as u64) as i64));
        active.result_preview = Set(result_preview);
        active.finished_at = Set(Some(Utc::now()));
        active.update(conn).await?;
    }
    Ok(())
}

/// A task running again under the same id (`resume_delegation`).
pub async fn mark_running(conn: &DatabaseConnection, task_id: &str) -> Result<(), DbError> {
    if let Some(row) = get(conn, task_id).await? {
        let mut active: delegation_task::ActiveModel = row.into();
        active.status = Set("running".to_string());
        active.error_code = Set(None);
        active.finished_at = Set(None);
        active.update(conn).await?;
    }
    Ok(())
}

/// The worktree a delegation made at `path`, if it is still recorded as
/// present.
pub async fn worktree_at(
    conn: &DatabaseConnection,
    path: &str,
) -> Result<Option<delegation_task::Model>, DbError> {
    Ok(delegation_task::Entity::find()
        .filter(delegation_task::Column::WorktreePath.eq(path))
        .filter(delegation_task::Column::WorktreeRemovedAt.is_null())
        .order_by_asc(delegation_task::Column::CreatedAt)
        .one(conn)
        .await?)
}

/// Record that the worktree at `path` is gone.
pub async fn mark_worktree_removed(conn: &DatabaseConnection, path: &str) -> Result<(), DbError> {
    let rows = delegation_task::Entity::find()
        .filter(delegation_task::Column::WorktreePath.eq(path))
        .filter(delegation_task::Column::WorktreeRemovedAt.is_null())
        .all(conn)
        .await?;
    let now = Utc::now();
    for row in rows {
        let mut active: delegation_task::ActiveModel = row.into();
        active.worktree_removed_at = Set(Some(now));
        active.update(conn).await?;
    }
    Ok(())
}
