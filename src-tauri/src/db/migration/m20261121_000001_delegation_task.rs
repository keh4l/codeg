use sea_orm_migration::prelude::*;

/// keh4l build: one row per delegated task (`delegate_to_agent`, and each
/// round of `continue_delegation`), so what a task was launched with and how
/// it ended outlive the broker's memory — a restart, a resumed or continued
/// task, a worktree to clean up. See `crate::acp::delegation::ledger`.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DelegationTask::Table)
                    .if_not_exists()
                    // The broker's task id (= the child row's delegation_call_id
                    // for the first round).
                    .col(
                        ColumnDef::new(DelegationTask::TaskId)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(DelegationTask::ParentConversationId)
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(DelegationTask::ChildConversationId).integer())
                    .col(ColumnDef::new(DelegationTask::ParentToolUseId).text())
                    // 1 for `delegate_to_agent`; n + 1 for a continuation of
                    // round n, whose task id is `source_task_id`.
                    .col(
                        ColumnDef::new(DelegationTask::Round)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .col(ColumnDef::new(DelegationTask::SourceTaskId).text())
                    .col(ColumnDef::new(DelegationTask::AgentType).text().not_null())
                    .col(ColumnDef::new(DelegationTask::AssistantId).integer())
                    .col(ColumnDef::new(DelegationTask::AssistantName).text())
                    // What the child was launched with, after every layer was
                    // applied: `{ "mode_id": …, "config": { id: value } }`.
                    .col(ColumnDef::new(DelegationTask::LaunchConfig).text())
                    .col(ColumnDef::new(DelegationTask::RequestedModel).text())
                    // `shared` / `worktree`.
                    .col(
                        ColumnDef::new(DelegationTask::Isolation)
                            .text()
                            .not_null()
                            .default("shared"),
                    )
                    .col(ColumnDef::new(DelegationTask::WorkingDir).text())
                    .col(ColumnDef::new(DelegationTask::WorktreeRepo).text())
                    .col(ColumnDef::new(DelegationTask::WorktreePath).text())
                    .col(ColumnDef::new(DelegationTask::WorktreeBranch).text())
                    .col(ColumnDef::new(DelegationTask::WorktreeBaseSha).text())
                    .col(
                        ColumnDef::new(DelegationTask::WorktreeRemovedAt)
                            .timestamp_with_time_zone(),
                    )
                    .col(ColumnDef::new(DelegationTask::TaskText).text())
                    .col(ColumnDef::new(DelegationTask::RequestHash).text())
                    // `running` / `completed` / `failed` / `canceled`.
                    .col(
                        ColumnDef::new(DelegationTask::Status)
                            .text()
                            .not_null()
                            .default("running"),
                    )
                    .col(ColumnDef::new(DelegationTask::ErrorCode).text())
                    .col(ColumnDef::new(DelegationTask::DurationMs).big_integer())
                    .col(ColumnDef::new(DelegationTask::ResultPreview).text())
                    .col(
                        ColumnDef::new(DelegationTask::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(DelegationTask::FinishedAt).timestamp_with_time_zone())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_delegation_task_child_conversation")
                    .table(DelegationTask::Table)
                    .col(DelegationTask::ChildConversationId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_delegation_task_parent_conversation")
                    .table(DelegationTask::Table)
                    .col(DelegationTask::ParentConversationId)
                    .to_owned(),
            )
            .await?;
        // One continuation per round: two `continue_delegation` calls racing on
        // the same round cannot both claim it.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_delegation_task_source_unique")
                    .table(DelegationTask::Table)
                    .col(DelegationTask::SourceTaskId)
                    .unique()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(DelegationTask::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum DelegationTask {
    Table,
    TaskId,
    ParentConversationId,
    ChildConversationId,
    ParentToolUseId,
    Round,
    SourceTaskId,
    AgentType,
    AssistantId,
    AssistantName,
    LaunchConfig,
    RequestedModel,
    Isolation,
    WorkingDir,
    WorktreeRepo,
    WorktreePath,
    WorktreeBranch,
    WorktreeBaseSha,
    WorktreeRemovedAt,
    TaskText,
    RequestHash,
    Status,
    ErrorCode,
    DurationMs,
    ResultPreview,
    CreatedAt,
    FinishedAt,
}
