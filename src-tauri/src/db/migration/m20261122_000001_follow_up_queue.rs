use sea_orm_migration::prelude::*;

/// keh4l build: mid-turn follow-ups (`crate::acp::follow_up`).
///
/// - `follow_up_queue`: messages waiting for the running turn to end, one
///   queue per conversation, sent by the server in `position` order. Whether a
///   queue is held lives in memory; a queue found here at startup starts held.
/// - `steer_record`: each message the user steered into a running turn, so the
///   transcript can still mark it after a reload.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(FollowUpQueue::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(FollowUpQueue::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(FollowUpQueue::ConversationId)
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(FollowUpQueue::Position).integer().not_null())
                    // What the composer shows for the item.
                    .col(ColumnDef::new(FollowUpQueue::Text).text().not_null())
                    // The prompt blocks to send (JSON array).
                    .col(ColumnDef::new(FollowUpQueue::Blocks).text().not_null())
                    // Send options captured with the item (JSON object).
                    .col(ColumnDef::new(FollowUpQueue::Options).text())
                    .col(
                        ColumnDef::new(FollowUpQueue::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(FollowUpQueue::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_follow_up_queue_conversation")
                    .table(FollowUpQueue::Table)
                    .col(FollowUpQueue::ConversationId)
                    .col(FollowUpQueue::Position)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(SteerRecord::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SteerRecord::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SteerRecord::ConversationId)
                            .integer()
                            .not_null(),
                    )
                    // `native` / `restart`.
                    .col(ColumnDef::new(SteerRecord::How).text().not_null())
                    .col(ColumnDef::new(SteerRecord::Text).text().not_null())
                    // `pending` / `read` / `requeued` / `undelivered`.
                    .col(ColumnDef::new(SteerRecord::Status).text().not_null())
                    .col(
                        ColumnDef::new(SteerRecord::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(SteerRecord::ReadAt).timestamp_with_time_zone())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_steer_record_conversation")
                    .table(SteerRecord::Table)
                    .col(SteerRecord::ConversationId)
                    .if_not_exists()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SteerRecord::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(FollowUpQueue::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum FollowUpQueue {
    Table,
    Id,
    ConversationId,
    Position,
    Text,
    Blocks,
    Options,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SteerRecord {
    Table,
    Id,
    ConversationId,
    How,
    Text,
    Status,
    CreatedAt,
    ReadAt,
}
