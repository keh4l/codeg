//! Caching the static front end (fork).
//!
//! `/_next/static/` is fingerprinted: a build puts its scripts and styles
//! there under new names, so a file found there never changes. It was sent
//! with no freshness at all, so browsers kept it only for a tenth of its age
//! and then asked again, one 304 per chunk; right after an install that was
//! every chunk on every load. Now it is `immutable` for a year — and a name
//! that is not there is a 404 (`no-store`), not the `index.html` the SPA
//! fallback would send: an open page of the previous release asking for its
//! old chunks must not run a document as a script, or keep it under the
//! chunk's name.
//!
//! Everything else keeps its name from one release to the next (the HTML
//! documents above all) and is revalidated on every use (`no-cache`, set by
//! the router's `static_cache_control`). It gets a content ETag, so the
//! revalidation answers 304 by content, not only by the modification time a
//! release may keep. The hash is kept per (path, size, mtime).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};

const FINGERPRINTED_PREFIX: &str = "/_next/static/";
const IMMUTABLE: &str = "public, max-age=31536000, immutable";
/// Files hashed for an ETag at most this large; bigger ones keep
/// `Last-Modified` alone.
const MAX_ETAG_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_KEPT_ETAGS: usize = 4096;

struct Kept {
    len: u64,
    modified: Option<SystemTime>,
    etag: String,
}

fn kept() -> &'static Mutex<HashMap<PathBuf, Kept>> {
    static KEPT: OnceLock<Mutex<HashMap<PathBuf, Kept>>> = OnceLock::new();
    KEPT.get_or_init(Default::default)
}

/// The file under `root` a request path names, as ServeDir would serve it
/// (`/` and directories → their `index.html`). `None` for a path that does
/// not decode, or that climbs out of `root`.
fn file_for(root: &Path, request_path: &str) -> Option<PathBuf> {
    let decoded = percent_encoding::percent_decode_str(request_path)
        .decode_utf8()
        .ok()?;
    let mut path = root.to_path_buf();
    for part in decoded.split('/') {
        match part {
            "" | "." => {}
            ".." => return None,
            part if part.contains('\\') => return None,
            part => path.push(part),
        }
    }
    if path.is_dir() {
        path.push("index.html");
    }
    Some(path)
}

/// The weak content ETag of `file`, from the kept ones while its size and
/// mtime are unchanged. `None` when it is not a readable regular file.
async fn etag_for(file: PathBuf) -> Option<String> {
    let meta = tokio::fs::metadata(&file).await.ok()?;
    if !meta.is_file() || meta.len() > MAX_ETAG_FILE_BYTES {
        return None;
    }
    let modified = meta.modified().ok();
    if let Ok(kept) = kept().lock() {
        if let Some(k) = kept.get(&file) {
            if k.len == meta.len() && k.modified == modified {
                return Some(k.etag.clone());
            }
        }
    }
    let bytes = tokio::fs::read(&file).await.ok()?;
    let len = bytes.len() as u64;
    let digest = tokio::task::spawn_blocking(move || Sha256::digest(&bytes))
        .await
        .ok()?;
    // Weak: the compression layer may send it encoded.
    let hash: String = digest[..12].iter().map(|b| format!("{b:02x}")).collect();
    let etag = format!("W/\"{hash}\"");
    if let Ok(mut kept) = kept().lock() {
        if kept.len() >= MAX_KEPT_ETAGS {
            kept.clear();
        }
        kept.insert(
            file,
            Kept {
                len,
                modified,
                etag: etag.clone(),
            },
        );
    }
    Some(etag)
}

/// Whether an `If-None-Match` value names `etag` (weak comparison).
fn matches(if_none_match: &str, etag: &str) -> bool {
    let bare = |tag: &str| tag.trim().trim_start_matches("W/").to_string();
    let wanted = bare(etag);
    if_none_match
        .split(',')
        .any(|tag| tag.trim() == "*" || bare(tag) == wanted)
}

/// The middleware, outside the router's `static_cache_control`.
pub async fn serve(root: PathBuf, mut req: axum::extract::Request, next: Next) -> Response {
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return next.run(req).await;
    }
    let path = req.uri().path().to_string();

    if path.starts_with(FINGERPRINTED_PREFIX) {
        let present = match file_for(&root, &path) {
            Some(file) => tokio::fs::metadata(&file)
                .await
                .map(|m| m.is_file())
                .unwrap_or(false),
            None => false,
        };
        if !present {
            return (
                StatusCode::NOT_FOUND,
                [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            )
                .into_response();
        }
        let mut response = next.run(req).await;
        if response.status().is_success() {
            response
                .headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static(IMMUTABLE));
        }
        return response;
    }

    let etag = match file_for(&root, &path) {
        Some(file) => etag_for(file).await,
        None => None,
    };
    let Some(etag) = etag else {
        return next.run(req).await;
    };
    if let Some(wanted) = req
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    {
        if matches(wanted, &etag) {
            let mut response = StatusCode::NOT_MODIFIED.into_response();
            let headers = response.headers_mut();
            if let Ok(value) = HeaderValue::from_str(&etag) {
                headers.insert(header::ETAG, value);
            }
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            return response;
        }
        // The ETag decides: a date the file may have kept must not answer
        // 304 for content that changed.
        req.headers_mut().remove(header::IF_MODIFIED_SINCE);
    }
    let mut response = next.run(req).await;
    if response.status() == StatusCode::OK {
        if let Ok(value) = HeaderValue::from_str(&etag) {
            response.headers_mut().insert(header::ETAG, value);
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn if_none_match_compares_weakly() {
        assert!(matches("W/\"abc\"", "W/\"abc\""));
        assert!(matches("\"abc\"", "W/\"abc\""));
        assert!(matches("\"x\", W/\"abc\"", "W/\"abc\""));
        assert!(matches("*", "W/\"abc\""));
        assert!(!matches("W/\"abd\"", "W/\"abc\""));
    }

    #[test]
    fn paths_stay_inside_the_root() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("a")).unwrap();
        assert_eq!(
            file_for(root.path(), "/"),
            Some(root.path().join("index.html"))
        );
        assert_eq!(
            file_for(root.path(), "/a"),
            Some(root.path().join("a/index.html"))
        );
        assert_eq!(
            file_for(root.path(), "/x%20y.txt"),
            Some(root.path().join("x y.txt"))
        );
        assert_eq!(file_for(root.path(), "/../etc/passwd"), None);
        assert_eq!(file_for(root.path(), "/a/%2e%2e/%2e%2e/x"), None);
    }
}
