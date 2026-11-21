use sea_orm::entity::prelude::*;

/// keh4l build: one delegated task (or one round of a continued one). See
/// `m20261121_000001_delegation_task` and `crate::acp::delegation::ledger`.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "delegation_task")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub task_id: String,
    pub parent_conversation_id: i32,
    pub child_conversation_id: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub parent_tool_use_id: Option<String>,
    pub round: i32,
    #[sea_orm(column_type = "Text", nullable)]
    pub source_task_id: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub agent_type: String,
    pub assistant_id: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub assistant_name: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub launch_config: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub requested_model: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub isolation: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub working_dir: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub worktree_repo: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub worktree_path: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub worktree_branch: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub worktree_base_sha: Option<String>,
    pub worktree_removed_at: Option<DateTimeUtc>,
    #[sea_orm(column_type = "Text", nullable)]
    pub task_text: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub request_hash: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub status: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub error_code: Option<String>,
    pub duration_ms: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub result_preview: Option<String>,
    pub created_at: DateTimeUtc,
    pub finished_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
