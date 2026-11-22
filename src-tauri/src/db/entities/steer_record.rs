use sea_orm::entity::prelude::*;

/// keh4l build: one message steered into a running turn. See
/// `m20261122_000001_follow_up_queue` and `crate::acp::follow_up`.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "steer_record")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub id: String,
    pub conversation_id: i32,
    #[sea_orm(column_type = "Text")]
    pub how: String,
    #[sea_orm(column_type = "Text")]
    pub text: String,
    #[sea_orm(column_type = "Text")]
    pub status: String,
    pub created_at: DateTimeUtc,
    pub read_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
