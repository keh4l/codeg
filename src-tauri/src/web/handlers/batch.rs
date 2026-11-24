//! `POST /api/batch` (fork): several API calls in one request.
//!
//! Over a slow link a browser sends at most six requests at a time over
//! HTTP/1.1, so a burst of small reads — the ~30 a workspace makes as it
//! loads, the ~20 lists re-read after a reconnect, the touches of every open
//! conversation — goes out in waves, a round trip each. The web transport now
//! sends the reads it knows to be quick in one batch, and this answers it.
//!
//! Each call is handed to the same router a request of its own would reach —
//! with the batch request's headers (its credentials above all), through the
//! same authentication, layers and handler — so it answers exactly what the
//! call alone would. The calls run concurrently. The answer goes back when
//! all of them are done, or at `BATCH_DEADLINE`: a call still running then is
//! dropped and reported `deferred`, and the client sends it alone. A batch
//! inside a batch is refused.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::body::Body;
use axum::extract::Extension;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tower_service::Service;

use crate::app_error::AppCommandError;

/// The router batch calls are dispatched through, set once it is built
/// (`web::router`). It holds the router that holds it: built once per
/// process, so the cycle is never collected and never needs to be.
pub type BatchTarget = Arc<OnceLock<Router>>;

/// Marks a request dispatched by a batch, so it cannot batch in turn.
pub const BATCH_CALL_HEADER: &str = "x-codeg-batch-call";
const MAX_CALLS: usize = 64;
const BATCH_DEADLINE: Duration = Duration::from_secs(2);
/// An answer bigger than this is not carried in the batch: the call is
/// reported `deferred` and the client asks for it alone.
const MAX_CALL_BODY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct BatchParams {
    pub calls: Vec<BatchCall>,
}

#[derive(Debug, Deserialize)]
pub struct BatchCall {
    pub cmd: String,
    #[serde(default)]
    pub args: Option<serde_json::Value>,
}

/// One call's answer. `s` the status; `b` the body when it is JSON, `t` when
/// it is not; `w` the `WWW-Authenticate` of a 401 (which part answered it);
/// `d` when it did not run to the end here.
#[derive(Debug, Default, Serialize, PartialEq)]
pub struct CallResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub s: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub b: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub d: bool,
}

impl CallResult {
    fn deferred() -> Self {
        Self {
            d: true,
            ..Self::default()
        }
    }

    fn refused(message: &str) -> Self {
        Self {
            s: Some(StatusCode::BAD_REQUEST.as_u16()),
            b: Some(serde_json::json!({ "code": "invalid_params", "message": message })),
            ..Self::default()
        }
    }
}

#[derive(Debug, Serialize)]
pub struct BatchResponse {
    pub results: Vec<CallResult>,
}

/// A command name as the routes spell them: one path segment.
fn valid_command(cmd: &str) -> bool {
    !cmd.is_empty()
        && cmd.len() <= 128
        && cmd != "batch"
        && cmd
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// The batch request's headers a call takes along: all but the ones that
/// describe the batch's own body and connection, and its accepted encodings
/// (the batch answer is what gets compressed).
fn forwarded(headers: &HeaderMap) -> HeaderMap {
    let mut out = HeaderMap::new();
    for (name, value) in headers {
        if name == header::CONTENT_LENGTH
            || name == header::CONTENT_TYPE
            || name == header::TRANSFER_ENCODING
            || name == header::CONNECTION
            || name == header::ACCEPT_ENCODING
            || name == header::EXPECT
            || name.as_str() == "keep-alive"
            || name.as_str() == "upgrade"
            || name.as_str() == "te"
        {
            continue;
        }
        out.append(name.clone(), value.clone());
    }
    out
}

async fn dispatch(mut router: Router, headers: HeaderMap, call: BatchCall) -> CallResult {
    if !valid_command(&call.cmd) {
        return CallResult::refused("not a command that can be batched");
    }
    let body = serde_json::to_vec(&call.args.unwrap_or_else(|| serde_json::json!({})))
        .unwrap_or_else(|_| b"{}".to_vec());
    let Ok(mut req) = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/{}", call.cmd))
        .body(Body::from(body))
    else {
        return CallResult::refused("not a command that can be batched");
    };
    *req.headers_mut() = headers;
    req.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    req.headers_mut().insert(
        HeaderName::from_static(BATCH_CALL_HEADER),
        HeaderValue::from_static("1"),
    );
    let ready =
        std::future::poll_fn(|cx| <Router as Service<Request<Body>>>::poll_ready(&mut router, cx))
            .await;
    if ready.is_err() {
        return CallResult::deferred();
    }
    let Ok(response) = router.call(req).await;
    let status = response.status();
    let challenge = (status == StatusCode::UNAUTHORIZED)
        .then(|| {
            response
                .headers()
                .get(header::WWW_AUTHENTICATE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        })
        .flatten();
    let Ok(bytes) = axum::body::to_bytes(response.into_body(), MAX_CALL_BODY_BYTES).await else {
        return CallResult::deferred();
    };
    let mut result = CallResult {
        s: Some(status.as_u16()),
        w: challenge,
        ..CallResult::default()
    };
    if !bytes.is_empty() {
        match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(value) => result.b = Some(value),
            Err(_) => result.t = Some(String::from_utf8_lossy(&bytes).into_owned()),
        }
    }
    result
}

pub async fn batch(
    Extension(target): Extension<BatchTarget>,
    headers: HeaderMap,
    Json(params): Json<BatchParams>,
) -> Result<Json<BatchResponse>, AppCommandError> {
    if headers.contains_key(BATCH_CALL_HEADER) {
        return Err(AppCommandError::invalid_input(
            "a batch cannot hold a batch",
        ));
    }
    if params.calls.len() > MAX_CALLS {
        return Err(AppCommandError::invalid_input(
            "too many calls in one batch",
        ));
    }
    let Some(router) = target.get().cloned() else {
        return Err(AppCommandError::task_execution_failed(
            "batch calls are not available yet",
        ));
    };
    let headers = forwarded(&headers);
    let deadline = tokio::time::Instant::now() + BATCH_DEADLINE;
    let calls = params.calls.into_iter().map(|call| {
        let router = router.clone();
        let headers = headers.clone();
        async move {
            tokio::time::timeout_at(deadline, dispatch(router, headers, call))
                .await
                .unwrap_or_else(|_| CallResult::deferred())
        }
    });
    let results = futures::future::join_all(calls).await;
    Ok(Json(BatchResponse { results }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_names() {
        assert!(valid_command("list_all_conversations"));
        assert!(valid_command("get_git_head"));
        assert!(!valid_command("batch"));
        assert!(!valid_command("account/srn"));
        assert!(!valid_command("../health"));
        assert!(!valid_command(""));
        assert!(!valid_command("List"));
    }

    #[test]
    fn takes_credentials_not_the_batch_body() {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer t"));
        headers.insert(
            "x-requested-with",
            HeaderValue::from_static("XMLHttpRequest"),
        );
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("99"));
        headers.insert(header::ACCEPT_ENCODING, HeaderValue::from_static("gzip"));
        let out = forwarded(&headers);
        assert_eq!(out.get(header::AUTHORIZATION).unwrap(), "Bearer t");
        assert_eq!(out.get("x-requested-with").unwrap(), "XMLHttpRequest");
        assert!(out.get(header::CONTENT_LENGTH).is_none());
        assert!(out.get(header::ACCEPT_ENCODING).is_none());
    }

    #[test]
    fn answers_in_short_fields() {
        let json = serde_json::to_value(BatchResponse {
            results: vec![
                CallResult {
                    s: Some(200),
                    b: Some(serde_json::json!([1])),
                    ..CallResult::default()
                },
                CallResult::deferred(),
            ],
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "results": [{ "s": 200, "b": [1] }, { "d": true }] })
        );
    }
}
