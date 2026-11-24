//! `ConnectionManager::cancel_turn` (fork): a Stop names the turn it was
//! pressed for, and does not stop a turn started since.

use codeg_lib::acp::connection::ConnectionCommand;
use codeg_lib::acp::manager::ConnectionManager;
use codeg_lib::acp::session_state::PendingUserMessage;
use codeg_lib::db::test_helpers::fresh_in_memory_db;
use codeg_lib::models::AgentType;
use codeg_lib::web::event_bridge::EventEmitter;

fn running(message_id: &str) -> Option<PendingUserMessage> {
    Some(PendingUserMessage {
        message_id: message_id.to_string(),
        blocks: Vec::new(),
    })
}

#[tokio::test]
async fn a_stop_leaves_a_turn_started_since_alone() {
    let db = fresh_in_memory_db().await;
    let mgr = ConnectionManager::new();
    let mut rx = mgr
        .insert_test_connection_live("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
        .await;
    let state = mgr.get_state("c1").await.expect("state");
    let stops = |rx: &mut tokio::sync::mpsc::Receiver<ConnectionCommand>| {
        let mut n = 0;
        while let Ok(command) = rx.try_recv() {
            assert!(matches!(command, ConnectionCommand::Cancel));
            n += 1;
        }
        n
    };

    // The turn the Stop was for ended and the queue started the next one.
    state.write().await.pending_user_message = running("turn-2");
    assert!(!mgr
        .cancel_turn(&db.conn, "c1", Some("turn-1"))
        .await
        .expect("cancel"));
    assert_eq!(stops(&mut rx), 0, "the new turn keeps running");

    // The turn on screen is the one running.
    assert!(mgr
        .cancel_turn(&db.conn, "c1", Some("turn-2"))
        .await
        .expect("cancel"));
    assert_eq!(stops(&mut rx), 1);

    // Which turn runs is not known, or the Stop names none: stop it.
    state.write().await.pending_user_message = None;
    assert!(mgr
        .cancel_turn(&db.conn, "c1", Some("turn-1"))
        .await
        .expect("cancel"));
    assert!(mgr.cancel_turn(&db.conn, "c1", None).await.expect("cancel"));
    assert_eq!(stops(&mut rx), 2);
}
