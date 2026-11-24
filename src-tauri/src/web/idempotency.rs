//! keh4l build: a call sent again with the same `X-Codeg-Idempotency-Key`
//! gets the first call's answer instead of running twice.
//!
//! The web client sends a call again when the network failed under it
//! (`CallOptions.retry` in `web-transport.ts`) — but a failure on the way
//! back means the server may already have done it. Sending a message, for
//! one, must not start a second turn, nor fail as "a turn is in flight"
//! (which would queue the message to be sent again). With a key:
//!
//! - the first call runs to completion in its own task even if its client
//!   goes away, and its answer (status, content type, body) is kept for
//!   [`TTL`];
//! - a call with the same key while the first is running waits for it;
//!   after it, gets its answer at once.
//!
//! Keys are scoped to the credentials that sent them and the path. Only for
//! small JSON answers: a body over [`MAX_BODY`] is answered to the first
//! call but not kept, and a repeat then gets a 409. Calls without the header
//! are untouched.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};
use tokio::sync::watch;

pub const HEADER: &str = "x-codeg-idempotency-key";
/// How long an answer is kept for repeats.
pub const TTL: Duration = Duration::from_secs(10 * 60);
/// At most this many answers are kept (the oldest go first).
pub const MAX_ENTRIES: usize = 1024;
/// Larger answers are not kept.
pub const MAX_BODY: usize = 256 * 1024;
const MAX_KEY_LEN: usize = 128;

#[derive(Clone, Debug)]
struct Answer {
    status: StatusCode,
    content_type: Option<HeaderValue>,
    /// `None` when it was too large to keep.
    body: Option<Bytes>,
}

impl Answer {
    fn replay(&self) -> Response {
        let Some(body) = &self.body else {
            return (
                StatusCode::CONFLICT,
                axum::Json(serde_json::json!({
                    "code": "duplicate_request",
                    "message": "this request already ran; its answer was too large to keep",
                })),
            )
                .into_response();
        };
        let mut response = Response::new(Body::from(body.clone()));
        *response.status_mut() = self.status;
        if let Some(content_type) = &self.content_type {
            response
                .headers_mut()
                .insert(header::CONTENT_TYPE, content_type.clone());
        }
        response
    }
}

enum Slot {
    Running(watch::Receiver<Option<Answer>>),
    Done { answer: Answer, at: Instant },
}

enum Begin {
    Run(watch::Sender<Option<Answer>>),
    Wait(watch::Receiver<Option<Answer>>),
    Replay(Answer),
}

#[derive(Default)]
pub struct IdempotencyCache {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    slots: HashMap<String, Slot>,
    /// Finished keys, oldest first, for expiry and the size bound.
    order: VecDeque<(String, Instant)>,
}

impl IdempotencyCache {
    pub fn new_shared() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn begin(&self, key: &str, now: Instant) -> Begin {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.expire(now);
        match inner.slots.get(key) {
            Some(Slot::Done { answer, .. }) => Begin::Replay(answer.clone()),
            Some(Slot::Running(rx)) => Begin::Wait(rx.clone()),
            None => {
                let (tx, rx) = watch::channel(None);
                inner.slots.insert(key.to_string(), Slot::Running(rx));
                Begin::Run(tx)
            }
        }
    }

    fn finish(&self, key: &str, answer: Answer, now: Instant) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner
            .slots
            .insert(key.to_string(), Slot::Done { answer, at: now });
        inner.order.push_back((key.to_string(), now));
        while inner.order.len() > MAX_ENTRIES {
            if let Some((old, at)) = inner.order.pop_front() {
                inner.remove_if_done_at(&old, at);
            }
        }
    }

    /// A run that never finished (its task panicked): forget it, so the key
    /// can run again.
    fn abandon(&self, key: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(inner.slots.get(key), Some(Slot::Running(_))) {
            inner.slots.remove(key);
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.inner.lock().unwrap().slots.len()
    }
}

impl Inner {
    fn expire(&mut self, now: Instant) {
        while let Some((key, at)) = self.order.front().cloned() {
            if now.duration_since(at) < TTL {
                break;
            }
            self.order.pop_front();
            self.remove_if_done_at(&key, at);
        }
    }

    /// Remove `key` if it still holds the answer finished at `at` (a key can
    /// only finish once, but stay exact).
    fn remove_if_done_at(&mut self, key: &str, at: Instant) {
        if matches!(self.slots.get(key), Some(Slot::Done { at: done, .. }) if *done == at) {
            self.slots.remove(key);
        }
    }
}

/// The cache key of a request that carries a usable idempotency key.
fn cache_key(req: &Request) -> Option<String> {
    let key = req.headers().get(HEADER)?.to_str().ok()?.trim();
    if key.is_empty() || key.len() > MAX_KEY_LEN {
        return None;
    }
    let mut who = Sha256::new();
    for name in [header::AUTHORIZATION, header::COOKIE] {
        if let Some(value) = req.headers().get(&name) {
            who.update(value.as_bytes());
        }
        who.update([0]);
    }
    let who = who.finalize();
    Some(format!(
        "{}\n{}\n{}",
        hex_prefix(&who[..12]),
        req.uri().path(),
        key
    ))
}

fn hex_prefix(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

async fn wait_for(mut rx: watch::Receiver<Option<Answer>>) -> Option<Answer> {
    loop {
        if let Some(answer) = rx.borrow_and_update().clone() {
            return Some(answer);
        }
        if rx.changed().await.is_err() {
            return rx.borrow().clone();
        }
    }
}

pub async fn middleware(
    State(cache): State<Arc<IdempotencyCache>>,
    req: Request,
    next: Next,
) -> Response {
    let Some(key) = cache_key(&req) else {
        return next.run(req).await;
    };
    match cache.begin(&key, Instant::now()) {
        Begin::Replay(answer) => answer.replay(),
        Begin::Wait(rx) => match wait_for(rx).await {
            Some(answer) => answer.replay(),
            None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        },
        Begin::Run(tx) => {
            // Runs to the end even if this client goes away: a repeat waits on
            // `tx`, and must get what the call did.
            let task_cache = cache.clone();
            let task_key = key.clone();
            let task = tokio::spawn(async move {
                let key = task_key;
                let response = next.run(req).await;
                let (parts, body) = response.into_parts();
                let (answer, bytes) = match axum::body::to_bytes(body, usize::MAX).await {
                    Ok(bytes) => {
                        let answer = Answer {
                            status: parts.status,
                            content_type: parts.headers.get(header::CONTENT_TYPE).cloned(),
                            body: (bytes.len() <= MAX_BODY).then(|| bytes.clone()),
                        };
                        (answer, Ok(bytes))
                    }
                    Err(err) => {
                        tracing::warn!("[idempotency] could not read an answer: {err}");
                        let answer = Answer {
                            status: StatusCode::INTERNAL_SERVER_ERROR,
                            content_type: None,
                            body: Some(Bytes::new()),
                        };
                        (answer, Err(()))
                    }
                };
                task_cache.finish(&key, answer.clone(), Instant::now());
                let _ = tx.send(Some(answer));
                bytes.map(|bytes| Response::from_parts(parts, Body::from(bytes)))
            });
            match task.await {
                Ok(Ok(response)) => response,
                Ok(Err(())) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                Err(err) => {
                    tracing::error!("[idempotency] a keyed call failed to finish: {err}");
                    cache.abandon(&key);
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer(body: &str) -> Answer {
        Answer {
            status: StatusCode::OK,
            content_type: None,
            body: Some(Bytes::from(body.to_string())),
        }
    }

    #[test]
    fn a_finished_key_replays_until_it_expires() {
        let cache = IdempotencyCache::default();
        let t0 = Instant::now();
        let Begin::Run(_tx) = cache.begin("k", t0) else {
            panic!("first call runs")
        };
        assert!(matches!(cache.begin("k", t0), Begin::Wait(_)));
        cache.finish("k", answer("1"), t0);
        assert!(
            matches!(cache.begin("k", t0), Begin::Replay(a) if a.body.as_deref() == Some(&b"1"[..]))
        );
        assert!(matches!(cache.begin("k", t0 + TTL), Begin::Run(_)));
    }

    #[test]
    fn the_oldest_answers_go_first() {
        let cache = IdempotencyCache::default();
        let t0 = Instant::now();
        for i in 0..MAX_ENTRIES + 5 {
            let key = format!("k{i}");
            let Begin::Run(_tx) = cache.begin(&key, t0) else {
                panic!("runs")
            };
            cache.finish(&key, answer("x"), t0);
        }
        assert_eq!(cache.len(), MAX_ENTRIES);
        assert!(matches!(cache.begin("k0", t0), Begin::Run(_)));
        assert!(matches!(cache.begin("k10", t0), Begin::Replay(_)));
    }

    #[test]
    fn a_key_is_scoped_to_its_credentials_and_path() {
        let req = |auth: &str, path: &str, key: &str| {
            Request::builder()
                .uri(path)
                .header(header::AUTHORIZATION, auth)
                .header(HEADER, key)
                .body(Body::empty())
                .unwrap()
        };
        let a = cache_key(&req("Bearer a", "/x", "k")).unwrap();
        assert_eq!(a, cache_key(&req("Bearer a", "/x", "k")).unwrap());
        assert_ne!(a, cache_key(&req("Bearer b", "/x", "k")).unwrap());
        assert_ne!(a, cache_key(&req("Bearer a", "/y", "k")).unwrap());
        assert!(cache_key(&req("Bearer a", "/x", " ")).is_none());
        assert!(cache_key(&req("Bearer a", "/x", &"k".repeat(200))).is_none());
    }
}
