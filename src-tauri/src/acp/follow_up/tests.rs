//! Engine tests that need no live agent: the stored queue, its order, the
//! held flag, and what the views carry.

use std::sync::Arc;

use super::*;
use crate::acp::internal_bus::EventBusMetrics;
use crate::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
use crate::models::agent::AgentType;

async fn engine_with_conversation() -> (Arc<Engine>, i32) {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/follow-up-tests").await;
    let conversation = seed_conversation(&db, folder, AgentType::ClaudeCode).await;
    let engine = Arc::new(Engine {
        rt: Runtime {
            db: Arc::new(db),
            manager: Arc::new(ConnectionManager::new()),
            emitter: EventEmitter::Noop,
            bus: Arc::new(InternalEventBus::new(Arc::new(EventBusMetrics::default()))),
        },
        held: Mutex::new(HashSet::new()),
        locks: Mutex::new(HashMap::new()),
        stops: Mutex::new(HashMap::new()),
        queued_at: Mutex::new(HashMap::new()),
    });
    (engine, conversation)
}

fn text(t: &str) -> Vec<PromptInputBlock> {
    vec![PromptInputBlock::Text { text: t.into() }]
}

#[tokio::test]
async fn queue_keeps_order_through_insert_reorder_and_remove() {
    let (engine, conv) = engine_with_conversation().await;
    let a = engine
        .enqueue_inner(conv, None, "a".into(), text("a"), ItemOptions::default())
        .await
        .unwrap();
    let b = engine
        .enqueue_inner(
            conv,
            None,
            "b".into(),
            text("b"),
            ItemOptions {
                mode_id: Some("plan".into()),
                adopt_send_time_mode: false,
            },
        )
        .await
        .unwrap();
    let c = engine
        .insert(conv, "c".into(), text("c"), ItemOptions::default(), Some(0))
        .await
        .unwrap();
    let ids = |v: &QueueView| v.items.iter().map(|i| i.id.clone()).collect::<Vec<_>>();
    let view = engine.view(conv).await.unwrap();
    assert_eq!(ids(&view), vec![c.clone(), a.clone(), b.clone()]);
    assert_eq!(
        view.items.iter().map(|i| i.position).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    assert_eq!(view.items[2].mode_id.as_deref(), Some("plan"));
    assert_eq!(view.items[2].blocks, text("b"));

    follow_up_service::reorder(engine.db(), conv, &[b.clone(), a.clone()])
        .await
        .unwrap();
    let view = engine.view(conv).await.unwrap();
    assert_eq!(ids(&view), vec![b.clone(), a.clone(), c.clone()]);

    follow_up_service::remove(engine.db(), &a).await.unwrap();
    let view = engine.view(conv).await.unwrap();
    assert_eq!(ids(&view), vec![b, c]);
    assert_eq!(
        view.items.iter().map(|i| i.position).collect::<Vec<_>>(),
        vec![0, 1]
    );
}

#[tokio::test]
async fn a_new_message_releases_a_held_queue() {
    let (engine, conv) = engine_with_conversation().await;
    engine
        .enqueue_inner(conv, None, "a".into(), text("a"), ItemOptions::default())
        .await
        .unwrap();
    engine.set_held(conv, true);
    assert!(engine.view(conv).await.unwrap().held);
    engine
        .enqueue_inner(conv, None, "b".into(), text("b"), ItemOptions::default())
        .await
        .unwrap();
    assert!(!engine.view(conv).await.unwrap().held);
}

#[tokio::test]
async fn an_empty_queue_is_never_held() {
    let (engine, conv) = engine_with_conversation().await;
    let id = engine
        .enqueue_inner(conv, None, "a".into(), text("a"), ItemOptions::default())
        .await
        .unwrap();
    engine.set_held(conv, true);
    follow_up_service::remove(engine.db(), &id).await.unwrap();
    engine.broadcast_queue(conv).await;
    assert!(!engine.is_held(conv));
    assert!(!engine.view(conv).await.unwrap().held);
}

#[tokio::test]
async fn flush_without_a_connection_sends_nothing() {
    let (engine, conv) = engine_with_conversation().await;
    engine
        .enqueue_inner(
            conv,
            Some("nope"),
            "a".into(),
            text("a"),
            ItemOptions::default(),
        )
        .await
        .unwrap();
    assert!(!engine.flush(conv, "nope").await.unwrap());
    assert_eq!(engine.view(conv).await.unwrap().items.len(), 1);
}

#[tokio::test]
async fn steer_records_round_trip() {
    let (engine, conv) = engine_with_conversation().await;
    engine
        .record_steer("s1", Some(conv), "restart", "use env.ts", "pending")
        .await;
    engine.set_steer_status("s1", Some(conv), "sent").await;
    engine
        .record_steer("s2", Some(conv), "native", "and tests", "sent")
        .await;
    let rows: Vec<SteerRecord> = follow_up_service::steers_of(engine.db(), conv)
        .await
        .unwrap()
        .into_iter()
        .map(steer_view)
        .collect();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].id, "s1");
    assert_eq!(rows[0].status, "sent");
    assert_eq!(rows[0].how, "restart");
    assert_eq!(rows[1].text, "and tests");
}

#[tokio::test]
async fn a_requeued_steer_goes_to_the_front() {
    let (engine, conv) = engine_with_conversation().await;
    engine
        .enqueue_inner(
            conv,
            None,
            "later".into(),
            text("later"),
            ItemOptions::default(),
        )
        .await
        .unwrap();
    engine
        .record_steer("s1", Some(conv), "restart", "now", "pending")
        .await;
    engine
        .requeue_steer(
            "nope",
            restart::PendingRestart {
                steer_id: "s1".into(),
                conversation_id: Some(conv),
                text: "now".into(),
                blocks: text("now"),
            },
        )
        .await;
    let view = engine.view(conv).await.unwrap();
    assert_eq!(view.items[0].text, "now");
    assert!(view.items[0].adopt_send_time_mode);
    assert_eq!(view.items[1].text, "later");
    let steers = follow_up_service::steers_of(engine.db(), conv)
        .await
        .unwrap();
    assert_eq!(steers[0].status, "requeued");
}

#[test]
fn views_serialize_for_the_frontend() {
    let result = SteerResult {
        how: SteerHow::NotRunning,
        steer_id: None,
        item_id: Some("i".into()),
    };
    assert_eq!(
        serde_json::to_value(&result).unwrap(),
        serde_json::json!({"how": "not_running", "steerId": null, "itemId": "i"})
    );
}
