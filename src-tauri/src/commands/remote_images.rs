//! Conversation images for remote-desktop windows (fork).
//!
//! A remote codeg-server sends conversation images by reference
//! (`web::image_refs`); the web client then loads `/api/img/{id}` from that
//! server like any image. A remote-desktop window cannot: its page is the
//! app's own origin, and a remote connection may need custom headers no
//! `<img>` can send. So the app serves them itself, from a loopback listener:
//!
//! `GET http://127.0.0.1:<port>/<secret>/<connection_id>/<id>`
//!
//! downloads the image from that connection's server once (bearer token and
//! the connection's custom headers, as every proxied call), keeps it on disk
//! under `cache/blobs/remote/<server>/` (bounded, least recently read
//! evicted) and serves it with the same `immutable` caching, so the webview
//! asks for it once. The random secret path segment keeps other local
//! processes from using the listener to reach remote servers with this app's
//! credentials; the blob id itself is the remote server's capability.

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use sea_orm::DatabaseConnection;
use sha2::{Digest, Sha256};

use crate::app_error::AppCommandError;
use crate::db::service::remote_workspace_connection_service;
use crate::db::AppDatabase;
use crate::models::ToHeaderMap;
use crate::web::blob_store;

/// Largest image fetched from a remote server.
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
/// Disk budget of the remote image cache (all servers together).
const CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024;
const CACHE_MAX_ENTRIES: usize = 20_000;

static BASE: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();

struct Ctx {
    db: DatabaseConnection,
    secret: String,
    root: PathBuf,
    writes: std::sync::atomic::AtomicU32,
}

/// The base URL images of remote connections load from in this app:
/// `<base>/<connection_id>/<id>`. Starts the listener on first use.
#[tauri::command]
pub async fn remote_image_base(
    db: tauri::State<'_, AppDatabase>,
) -> Result<String, AppCommandError> {
    let conn = db.conn.clone();
    let base = BASE
        .get_or_try_init(|| async move {
            start(conn, crate::paths::codeg_blobs_root().join("remote"))
                .await
                .map_err(AppCommandError::io)
        })
        .await?;
    Ok(base.clone())
}

async fn start(db: DatabaseConnection, root: PathBuf) -> std::io::Result<String> {
    let secret: String = (0..16)
        .map(|_| format!("{:02x}", rand::random::<u8>()))
        .collect();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let ctx = Arc::new(Ctx {
        db,
        secret: secret.clone(),
        root,
        writes: std::sync::atomic::AtomicU32::new(0),
    });
    let router = Router::new()
        .route("/{secret}/{connection_id}/{id}", get(serve))
        .with_state(ctx);
    tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, router).await {
            tracing::warn!("[remote-images] listener stopped: {err}");
        }
    });
    Ok(format!("http://{address}/{secret}"))
}

async fn serve(
    State(ctx): State<Arc<Ctx>>,
    Path((secret, connection_id, id)): Path<(String, i32, String)>,
    axum::extract::Query(query): axum::extract::Query<blob_store::ImageQuery>,
) -> Response {
    if !same_secret(&secret, &ctx.secret) || !blob_store::valid_id(&id) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(Some(conn)) = remote_workspace_connection_service::get(&ctx.db, connection_id).await
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let base = conn.base_url.trim_end_matches('/').to_string();
    // `?thumb=512` (inline display) is fetched and kept as its own file.
    let thumb = query.thumb == Some(blob_store::THUMB_EDGE);
    let variant = if thumb {
        format!("{id}-t{}", blob_store::THUMB_EDGE)
    } else {
        id.clone()
    };
    let path = ctx
        .root
        .join(server_dir(&base))
        .join(format!("{variant}.img"));
    let etag = format!("\"{variant}\"");

    if let Ok(bytes) = tokio::fs::read(&path).await {
        if let Some(mime) = blob_store::sniff_image_type(&bytes) {
            blob_store::touch(&path);
            return with_cors(blob_store::image_response(mime, &etag, bytes));
        }
    }

    let Ok(client) = crate::forge::http_client() else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    let response = client
        .get(if thumb {
            format!("{base}/api/img/{id}?thumb={}", blob_store::THUMB_EDGE)
        } else {
            format!("{base}/api/img/{id}")
        })
        .bearer_auth(conn.token.trim())
        .headers(conn.headers.to_header_map())
        .header("X-Requested-With", "XMLHttpRequest")
        .send()
        .await;
    let response = match response {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            return StatusCode::from_u16(response.status().as_u16())
                .unwrap_or(StatusCode::BAD_GATEWAY)
                .into_response()
        }
        Err(err) => {
            tracing::debug!("[remote-images] fetch failed: {}", err.without_url());
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    if response
        .content_length()
        .is_some_and(|len| len as usize > MAX_IMAGE_BYTES)
    {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    let Ok(bytes) = response.bytes().await else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    if bytes.len() > MAX_IMAGE_BYTES {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    let Some(mime) = blob_store::sniff_image_type(&bytes) else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    let bytes = bytes.to_vec();
    store(&ctx, &path, &bytes).await;
    with_cors(blob_store::image_response(mime, &etag, bytes))
}

/// Keep a downloaded image (best effort; failing to cache only costs a
/// download next time), pruning the cache now and then.
async fn store(ctx: &Arc<Ctx>, path: &std::path::Path, bytes: &[u8]) {
    let path = path.to_path_buf();
    let bytes = bytes.to_vec();
    let root = ctx.root.clone();
    let prune = ctx
        .writes
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        % 100
        == 99;
    let _ = tokio::task::spawn_blocking(move || {
        let dir = path.parent()?;
        std::fs::create_dir_all(dir).ok()?;
        let mut tmp = tempfile::NamedTempFile::new_in(dir).ok()?;
        std::io::Write::write_all(&mut tmp, &bytes).ok()?;
        tmp.persist(&path).ok()?;
        if prune {
            let _ = blob_store::prune_tree(&root, CACHE_MAX_BYTES, CACHE_MAX_ENTRIES);
        }
        Some(())
    })
    .await;
}

/// The page is the app's origin; `fetch` (copy, download, export) needs this.
/// The secret path is what guards the listener, not the origin.
fn with_cors(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static("*"),
    );
    response
}

/// One directory per server, named by a hash of its address (no token).
fn server_dir(base_url: &str) -> String {
    let digest = Sha256::digest(base_url.as_bytes());
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}

fn same_secret(given: &str, expected: &str) -> bool {
    given.len() == expected.len()
        && given
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A remote server's image is fetched once with the connection's token,
    /// cached, then served from disk; a wrong secret or id is a 404.
    #[tokio::test]
    async fn serves_a_remote_image_once_fetched() {
        use std::sync::atomic::{AtomicU32, Ordering};

        let png: Vec<u8> = b"\x89PNG\r\n\x1a\n remote image".to_vec();
        let id = "0123456789abcdef0123456789abcdef";
        let hits = Arc::new(AtomicU32::new(0));
        let remote = {
            let png = png.clone();
            let hits = hits.clone();
            Router::new().route(
                "/api/img/{id}",
                get(
                    move |headers: axum::http::HeaderMap, Path(got): Path<String>| {
                        let png = png.clone();
                        let hits = hits.clone();
                        async move {
                            hits.fetch_add(1, Ordering::SeqCst);
                            let authed = headers
                                .get(header::AUTHORIZATION)
                                .is_some_and(|v| v == "Bearer remote-token");
                            if !authed || got != "0123456789abcdef0123456789abcdef" {
                                return StatusCode::UNAUTHORIZED.into_response();
                            }
                            png.into_response()
                        }
                    },
                ),
            )
        };
        let remote_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let remote_addr = remote_listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(remote_listener, remote).await });

        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let conn = remote_workspace_connection_service::create(
            &db.conn,
            "remote",
            &format!("http://{remote_addr}"),
            "remote-token",
            &[],
        )
        .await
        .unwrap();
        let cache = tempfile::tempdir().unwrap();
        let base = start(db.conn.clone(), cache.path().to_path_buf())
            .await
            .unwrap();

        let client = reqwest::Client::new();
        let url = format!("{base}/{}/{id}", conn.id);
        for _ in 0..2 {
            let res = client.get(&url).send().await.unwrap();
            assert_eq!(res.status(), 200);
            assert_eq!(res.headers()["content-type"], "image/png");
            assert_eq!(res.headers()["access-control-allow-origin"], "*");
            assert_eq!(res.bytes().await.unwrap().as_ref(), png.as_slice());
        }
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "the second load came from disk"
        );

        let wrong_secret = base.rsplit_once('/').unwrap().0.to_string() + "/nope";
        for bad in [
            format!("{wrong_secret}/{}/{id}", conn.id),
            format!("{base}/{}/not-an-id", conn.id),
            format!("{base}/999/{id}"),
        ] {
            assert_eq!(
                client.get(&bad).send().await.unwrap().status(),
                404,
                "{bad}"
            );
        }
    }

    #[test]
    fn server_dirs_and_secrets() {
        assert_eq!(server_dir("http://a:1"), server_dir("http://a:1"));
        assert_ne!(server_dir("http://a:1"), server_dir("http://a:2"));
        assert_eq!(server_dir("http://a:1").len(), 16);
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abd", "abc"));
        assert!(!same_secret("ab", "abc"));
    }
}
