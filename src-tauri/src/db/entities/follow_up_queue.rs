use sea_orm::entity::prelude::*;

/// keh4l build: one message waiting for the running turn to end. See
/// `m20261122_000001_follow_up_queue` and `crate::acp::follow_up`.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "follow_up_queue")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub id: String,
    pub conversation_id: i32,
    pub position: i32,
    #[sea_orm(column_type = "Text")]
    pub text: String,
    #[sea_orm(column_type = "Text")]
    pub blocks: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub options: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
