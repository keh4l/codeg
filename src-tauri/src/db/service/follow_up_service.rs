//! keh4l build: reads and writes of the follow-up queue and the steer records.
//! See `crate::acp::follow_up`.
//!
//! Positions are kept dense (0, 1, 2 …) by rewriting the whole queue of a
//! conversation on every structural change; a queue holds a handful of rows.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait,
};

use crate::db::entities::{follow_up_queue, steer_record};
use crate::db::error::DbError;

/// A queue row before it is stored.
#[derive(Debug, Clone)]
pub struct NewItem {
    pub id: String,
    pub conversation_id: i32,
    pub text: String,
    pub blocks: String,
    pub options: Option<String>,
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    conversation_id: i32,
) -> Result<Vec<follow_up_queue::Model>, DbError> {
    Ok(follow_up_queue::Entity::find()
        .filter(follow_up_queue::Column::ConversationId.eq(conversation_id))
        .order_by_asc(follow_up_queue::Column::Position)
        .order_by_asc(follow_up_queue::Column::CreatedAt)
        .all(conn)
        .await?)
}

pub async fn get(
    conn: &DatabaseConnection,
    id: &str,
) -> Result<Option<follow_up_queue::Model>, DbError> {
    Ok(follow_up_queue::Entity::find_by_id(id.to_string())
        .one(conn)
        .await?)
}

/// Conversations that still have queued messages.
pub async fn conversations_with_items(conn: &DatabaseConnection) -> Result<Vec<i32>, DbError> {
    let rows: Vec<i32> = follow_up_queue::Entity::find()
        .select_only()
        .column(follow_up_queue::Column::ConversationId)
        .distinct()
        .into_tuple()
        .all(conn)
        .await?;
    Ok(rows)
}

async fn renumber<C: ConnectionTrait>(
    conn: &C,
    rows: &[follow_up_queue::Model],
) -> Result<(), DbError> {
    for (index, row) in rows.iter().enumerate() {
        let position = index as i32;
        if row.position != position {
            let mut active: follow_up_queue::ActiveModel = row.clone().into();
            active.position = Set(position);
            active.update(conn).await?;
        }
    }
    Ok(())
}

/// Store `item` at `index` (clamped; `None` = the end) and return the queue.
pub async fn insert(
    conn: &DatabaseConnection,
    item: NewItem,
    index: Option<usize>,
) -> Result<Vec<follow_up_queue::Model>, DbError> {
    let txn = conn.begin().await?;
    let mut rows = list(&txn, item.conversation_id).await?;
    let at = index.unwrap_or(rows.len()).min(rows.len());
    let now = Utc::now();
    let model = follow_up_queue::ActiveModel {
        id: Set(item.id),
        conversation_id: Set(item.conversation_id),
        position: Set(at as i32),
        text: Set(item.text),
        blocks: Set(item.blocks),
        options: Set(item.options),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&txn)
    .await?;
    rows.insert(at, model);
    renumber(&txn, &rows).await?;
    txn.commit().await?;
    Ok(rows)
}

/// Replace an item's content. `None` when it is gone.
pub async fn update_content(
    conn: &DatabaseConnection,
    id: &str,
    text: String,
    blocks: String,
    options: Option<Option<String>>,
) -> Result<Option<follow_up_queue::Model>, DbError> {
    let Some(row) = get(conn, id).await? else {
        return Ok(None);
    };
    let mut active: follow_up_queue::ActiveModel = row.into();
    active.text = Set(text);
    active.blocks = Set(blocks);
    if let Some(options) = options {
        active.options = Set(options);
    }
    active.updated_at = Set(Utc::now());
    Ok(Some(active.update(conn).await?))
}

/// Delete an item and close the gap. Returns the removed row.
pub async fn remove(
    conn: &DatabaseConnection,
    id: &str,
) -> Result<Option<follow_up_queue::Model>, DbError> {
    let txn = conn.begin().await?;
    let Some(row) = follow_up_queue::Entity::find_by_id(id.to_string())
        .one(&txn)
        .await?
    else {
        return Ok(None);
    };
    follow_up_queue::Entity::delete_by_id(id.to_string())
        .exec(&txn)
        .await?;
    let rest = list(&txn, row.conversation_id).await?;
    renumber(&txn, &rest).await?;
    txn.commit().await?;
    Ok(Some(row))
}

/// Put the queue in `ids` order. Ids not in the queue are ignored; queued
/// items missing from `ids` keep their relative order after the listed ones.
pub async fn reorder(
    conn: &DatabaseConnection,
    conversation_id: i32,
    ids: &[String],
) -> Result<Vec<follow_up_queue::Model>, DbError> {
    let txn = conn.begin().await?;
    let rows = list(&txn, conversation_id).await?;
    let mut ordered: Vec<follow_up_queue::Model> = ids
        .iter()
        .filter_map(|id| rows.iter().find(|r| &r.id == id).cloned())
        .collect();
    for row in &rows {
        if !ordered.iter().any(|r| r.id == row.id) {
            ordered.push(row.clone());
        }
    }
    renumber(&txn, &ordered).await?;
    txn.commit().await?;
    list(conn, conversation_id).await
}

/// Delete every queued item of a conversation.
pub async fn clear(conn: &DatabaseConnection, conversation_id: i32) -> Result<u64, DbError> {
    let res = follow_up_queue::Entity::delete_many()
        .filter(follow_up_queue::Column::ConversationId.eq(conversation_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

// ---------------------------------------------------------------- steers

pub async fn insert_steer(
    conn: &DatabaseConnection,
    id: &str,
    conversation_id: i32,
    how: &str,
    text: &str,
    status: &str,
) -> Result<(), DbError> {
    steer_record::ActiveModel {
        id: Set(id.to_string()),
        conversation_id: Set(conversation_id),
        how: Set(how.to_string()),
        text: Set(text.to_string()),
        status: Set(status.to_string()),
        created_at: Set(Utc::now()),
        read_at: Set(if status == "read" {
            Some(Utc::now())
        } else {
            None
        }),
    }
    .insert(conn)
    .await?;
    Ok(())
}

pub async fn set_steer_status(
    conn: &DatabaseConnection,
    id: &str,
    status: &str,
) -> Result<(), DbError> {
    let Some(row) = steer_record::Entity::find_by_id(id.to_string())
        .one(conn)
        .await?
    else {
        return Ok(());
    };
    let mut active: steer_record::ActiveModel = row.into();
    active.status = Set(status.to_string());
    if status == "read" {
        active.read_at = Set(Some(Utc::now()));
    }
    active.update(conn).await?;
    Ok(())
}

/// Every steer of a conversation, oldest first.
pub async fn steers_of(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Vec<steer_record::Model>, DbError> {
    Ok(steer_record::Entity::find()
        .filter(steer_record::Column::ConversationId.eq(conversation_id))
        .order_by_asc(steer_record::Column::CreatedAt)
        .all(conn)
        .await?)
}
