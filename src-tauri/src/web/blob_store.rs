//! Content-addressed blobs for conversation images and large tool bodies
//! (fork).
//!
//! Opening a conversation used to inline every screenshot as base64 in the
//! JSON (a 150 KB screenshot every few turns made a 120-turn window 630 KB),
//! and every reopen sent them all again. Instead, the detail projection
//! stores each image here once and sends a reference; the browser loads it
//! from `GET /api/img/{id}` like any image and keeps it in its HTTP cache.
//!
//! **Ids are capabilities.** `id = hex(HMAC-SHA256(key, domain || bytes))[..32]`
//! (128 bits) with a random per-install key (`<root>/.key`, mode 0600). Only
//! an authenticated response can tell a client an id, and the same bytes
//! always get the same id, so the URL is stable forever — which is what lets
//! a plain HTTP cache work on an insecure (plain http) origin, where Cache
//! Storage and `crypto.subtle` do not exist — and no token ever goes in a URL.
//! The image route is public (an `<img>` cannot send a bearer header), but it
//! serves only what an id names, and only images.
//!
//! **Bounded.** At most `MAX_BYTES` / `MAX_ENTRIES`, least recently read
//! first (reads touch the file's mtime). An evicted blob is a 404; the client
//! then refetches the detail, whose projection stores it again.

use std::collections::HashSet;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use hmac::{Hmac, Mac};
use sha2::Sha256;

/// Hex digits in an id.
pub const ID_LEN: usize = 32;
/// Disk budget for the whole store.
pub const MAX_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 50_000;

/// Domain separation: an image and a text body with the same bytes get
/// different ids, so an id for one can never be served as the other.
const IMAGE_DOMAIN: &[u8] = b"codeg-img-v1\0";
const TEXT_DOMAIN: &[u8] = b"codeg-txt-v1\0";

/// What a blob holds; part of its id and of its file name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlobKind {
    Image,
    Text,
}

impl BlobKind {
    fn domain(self) -> &'static [u8] {
        match self {
            BlobKind::Image => IMAGE_DOMAIN,
            BlobKind::Text => TEXT_DOMAIN,
        }
    }

    fn suffix(self) -> &'static str {
        match self {
            BlobKind::Image => "img",
            BlobKind::Text => "txt",
        }
    }
}

pub struct BlobStore {
    root: PathBuf,
    key: [u8; 32],
    /// Ids known to be on disk, so a projection that sees the same image on
    /// every open does not even `stat` it. Cleared by pruning.
    known: Mutex<HashSet<String>>,
    /// Writes since the last prune; pruning runs every `PRUNE_EVERY` writes.
    writes: Mutex<u32>,
}

const PRUNE_EVERY: u32 = 200;

impl BlobStore {
    /// Open (or create) the store at `root`.
    pub fn open(root: impl Into<PathBuf>) -> std::io::Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        let key = load_or_create_key(&root.join(".key"))?;
        Ok(Self {
            root,
            key,
            known: Mutex::new(HashSet::new()),
            writes: Mutex::new(0),
        })
    }

    /// The id `bytes` get as `kind`.
    pub fn id_for(&self, kind: BlobKind, bytes: &[u8]) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key).expect("HMAC takes any key length");
        mac.update(kind.domain());
        mac.update(bytes);
        let digest = mac.finalize().into_bytes();
        let mut id = String::with_capacity(ID_LEN);
        for byte in &digest[..ID_LEN / 2] {
            id.push_str(&format!("{byte:02x}"));
        }
        id
    }

    /// Store `bytes` (if not stored yet) and return their id.
    pub fn put(&self, kind: BlobKind, bytes: &[u8]) -> std::io::Result<String> {
        let id = self.id_for(kind, bytes);
        let name = file_name(&id, kind);
        if self
            .known
            .lock()
            .map(|k| k.contains(&name))
            .unwrap_or(false)
        {
            return Ok(id);
        }
        let path = self.path_of(&id, kind);
        if !path.is_file() {
            let dir = path.parent().expect("a blob path has a shard directory");
            std::fs::create_dir_all(dir)?;
            let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
            tmp.write_all(bytes)?;
            tmp.flush()?;
            // Another writer may have won the race; the bytes are identical.
            tmp.persist(&path).map_err(|e| e.error)?;
            self.note_write();
        }
        if let Ok(mut known) = self.known.lock() {
            known.insert(name);
        }
        Ok(id)
    }

    /// The bytes of blob `id`, touching it so pruning keeps it. `None` for an
    /// invalid id or a blob not (or no longer) stored.
    pub fn read(&self, kind: BlobKind, id: &str) -> Option<Vec<u8>> {
        let path = self.existing_path(kind, id)?;
        let bytes = std::fs::read(&path).ok()?;
        touch(&path);
        Some(bytes)
    }

    /// The file of blob `id`, if stored (touched, as [`read`](Self::read)).
    pub fn existing_path(&self, kind: BlobKind, id: &str) -> Option<PathBuf> {
        if !valid_id(id) {
            return None;
        }
        let path = self.path_of(id, kind);
        if !path.is_file() {
            return None;
        }
        touch(&path);
        Some(path)
    }

    fn path_of(&self, id: &str, kind: BlobKind) -> PathBuf {
        self.root.join(&id[..2]).join(file_name(id, kind))
    }

    /// Where image `id`'s thumbnail is (or will be) kept.
    fn thumb_path(&self, id: &str) -> PathBuf {
        self.root
            .join(&id[..2])
            .join(format!("{id}-t{THUMB_EDGE}.img"))
    }

    fn note_write(&self) {
        let due = match self.writes.lock() {
            Ok(mut writes) => {
                *writes += 1;
                if *writes >= PRUNE_EVERY {
                    *writes = 0;
                    true
                } else {
                    false
                }
            }
            Err(_) => false,
        };
        if due {
            if let Err(err) = self.prune() {
                tracing::warn!("[blobs] prune failed: {err}");
            }
        }
    }

    /// Evict least recently read blobs past `MAX_BYTES` / `MAX_ENTRIES`.
    pub fn prune(&self) -> std::io::Result<()> {
        self.prune_to(MAX_BYTES, MAX_ENTRIES)
    }

    fn prune_to(&self, max_bytes: u64, max_entries: usize) -> std::io::Result<()> {
        prune_tree(&self.root, max_bytes, max_entries)?;
        if let Ok(mut known) = self.known.lock() {
            known.clear();
        }
        Ok(())
    }
}

/// Evict blob files (`*.img`, `*.txt`) anywhere under `root` (two levels
/// deep), least recently read first, until at most `max_bytes` and
/// `max_entries` remain. Other files (the key) are never touched.
pub(crate) fn prune_tree(root: &Path, max_bytes: u64, max_entries: usize) -> std::io::Result<()> {
    fn collect(dir: &Path, depth: u8, out: &mut Vec<(SystemTime, u64, PathBuf)>) {
        let Ok(items) = std::fs::read_dir(dir) else {
            return;
        };
        for item in items.flatten() {
            let path = item.path();
            let Ok(metadata) = item.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                if depth > 0 {
                    collect(&path, depth - 1, out);
                }
            } else if metadata.is_file()
                && path
                    .extension()
                    .is_some_and(|ext| ext == "img" || ext == "txt")
            {
                let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                out.push((modified, metadata.len(), path));
            }
        }
    }
    let mut entries = Vec::new();
    collect(root, 2, &mut entries);
    entries.sort_by_key(|(modified, _, _)| *modified);
    let mut total: u64 = entries.iter().map(|(_, bytes, _)| bytes).sum();
    let mut count = entries.len();
    for (_, bytes, path) in entries {
        if total <= max_bytes && count <= max_entries {
            break;
        }
        let _ = std::fs::remove_file(&path);
        total = total.saturating_sub(bytes);
        count -= 1;
    }
    Ok(())
}

fn file_name(id: &str, kind: BlobKind) -> String {
    format!("{id}.{}", kind.suffix())
}

/// Whether `id` has the shape of an id (and so is safe in a path).
pub fn valid_id(id: &str) -> bool {
    id.len() == ID_LEN && id.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))
}

pub(crate) fn touch(path: &Path) {
    if let Ok(file) = std::fs::File::options().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

fn load_or_create_key(path: &Path) -> std::io::Result<[u8; 32]> {
    if let Ok(existing) = std::fs::read(path) {
        if let Ok(key) = <[u8; 32]>::try_from(existing.as_slice()) {
            return Ok(key);
        }
    }
    let key: [u8; 32] = rand::random();
    let dir = path.parent().expect("the key lives in the store");
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        tmp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    tmp.write_all(&key)?;
    tmp.flush()?;
    tmp.persist(path).map_err(|e| e.error)?;
    // A concurrent first start may have written its own key first; use
    // whichever is on disk so every id agrees.
    let on_disk = std::fs::read(path)?;
    Ok(<[u8; 32]>::try_from(on_disk.as_slice()).unwrap_or(key))
}

static GLOBAL: OnceLock<Option<BlobStore>> = OnceLock::new();

/// The process-wide store under the active data root, opened on first use.
/// `None` if it cannot be opened (read-only data dir): callers then keep
/// inlining, as before.
pub fn global() -> Option<&'static BlobStore> {
    GLOBAL
        .get_or_init(|| match BlobStore::open(crate::paths::codeg_blobs_root()) {
            Ok(store) => Some(store),
            Err(err) => {
                tracing::warn!("[blobs] store unavailable, images stay inline: {err}");
                None
            }
        })
        .as_ref()
}

/// Put the process-wide store at `root` instead (tests: keep blobs out of
/// the real data root). Only before its first use; later calls do nothing.
pub fn init_global(root: impl Into<PathBuf>) -> std::io::Result<()> {
    let store = BlobStore::open(root)?;
    let _ = GLOBAL.set(Some(store));
    Ok(())
}

/// The image type `bytes` actually are (never what a transcript claims).
/// `None` for anything that is not an image the client renders.
pub fn sniff_image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"avif" | b"avis")
    {
        Some("image/avif")
    } else if looks_like_svg(bytes) {
        Some("image/svg+xml")
    } else {
        None
    }
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(512)];
    let Ok(text) = std::str::from_utf8(head) else {
        return false;
    };
    let text = text.trim_start_matches('\u{feff}').trim_start();
    (text.starts_with("<svg") || text.starts_with("<?xml")) && text.contains("<svg")
}

// ─── Thumbnails ──────────────────────────────────────────────────────

/// Longest edge of a thumbnail.
pub const THUMB_EDGE: u32 = 512;
/// Images at least this big, or with an edge longer than `THUMB_MIN_EDGE`,
/// get a thumbnail for inline display (the preview still loads the original).
pub const THUMB_MIN_BYTES: usize = 96 * 1024;
pub const THUMB_MIN_EDGE: u32 = 1024;

/// Whether an image of `bytes` and `dimensions` should be shown inline as a
/// thumbnail.
pub fn wants_thumb(bytes: usize, dimensions: Option<(u32, u32)>) -> bool {
    bytes >= THUMB_MIN_BYTES
        || dimensions.is_some_and(|(w, h)| w > THUMB_MIN_EDGE || h > THUMB_MIN_EDGE)
}

/// A JPEG (quality 80) of `bytes` scaled to fit `THUMB_EDGE`, transparency
/// flattened onto white. `None` for what cannot be decoded within the limits
/// (formats not built in, decompression bombs).
pub fn make_thumbnail(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().ok()?;
    let small = decoded.thumbnail(THUMB_EDGE, THUMB_EDGE).to_rgba8();
    let flat = image::RgbImage::from_fn(small.width(), small.height(), |x, y| {
        let [r, g, b, a] = small.get_pixel(x, y).0;
        let over_white = |c: u8| ((c as u16 * a as u16 + 255 * (255 - a as u16)) / 255) as u8;
        image::Rgb([over_white(r), over_white(g), over_white(b)])
    });
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
        .encode_image(&flat)
        .ok()?;
    Some(out)
}

/// One thumbnail is made at a time: decoding a big image takes a lot of
/// memory and the only core.
static THUMB_LOCK: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

/// The thumbnail of image `id`, made on first request and kept beside it.
/// `None` when it cannot be made (the caller serves the original).
async fn thumbnail(store: &'static BlobStore, id: &str) -> Option<Vec<u8>> {
    let path = store.thumb_path(id);
    if let Ok(bytes) = tokio::fs::read(&path).await {
        touch(&path);
        return Some(bytes);
    }
    let _permit = THUMB_LOCK.acquire().await.ok()?;
    if let Ok(bytes) = tokio::fs::read(&path).await {
        return Some(bytes);
    }
    let original = store.existing_path(BlobKind::Image, id)?;
    tokio::task::spawn_blocking(move || {
        let bytes = std::fs::read(original).ok()?;
        let thumb = make_thumbnail(&bytes)?;
        let dir = path.parent()?;
        if let Ok(mut tmp) = tempfile::NamedTempFile::new_in(dir) {
            if tmp.write_all(&thumb).is_ok() {
                let _ = tmp.persist(&path);
            }
        }
        Some(thumb)
    })
    .await
    .ok()
    .flatten()
}

// ─── HTTP ────────────────────────────────────────────────────────────

use axum::extract::Path as AxumPath;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};

/// `GET /api/img/{id}` (public: an `<img>` cannot send a bearer header; the
/// id is the capability). Serves only images, typed by their bytes, cached by
/// the browser for good (`immutable`: an id always names the same bytes).
pub async fn serve_image(
    AxumPath(id): AxumPath<String>,
    axum::extract::Query(query): axum::extract::Query<ImageQuery>,
    headers: HeaderMap,
) -> Response {
    let Some(store) = global() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if query.thumb == Some(THUMB_EDGE)
        && valid_id(&id)
        && store.existing_path(BlobKind::Image, &id).is_some()
    {
        let etag = format!("\"{id}-t{THUMB_EDGE}\"");
        if if_none_match(&headers, &etag) {
            return not_modified(&etag);
        }
        if let Some(thumb) = thumbnail(store, &id).await {
            return image_response("image/jpeg", &etag, thumb);
        }
        // No thumbnail possible (an SVG, a format not built in): the original.
    }
    serve_image_from(store, &id, &headers).await
}

/// `?thumb=512` asks for the thumbnail.
#[derive(Debug, Default, serde::Deserialize)]
pub struct ImageQuery {
    #[serde(default)]
    pub thumb: Option<u32>,
}

fn if_none_match(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',')
                .any(|tag| tag.trim() == etag || tag.trim() == "*")
        })
}

fn not_modified(etag: &str) -> Response {
    Response::builder()
        .status(StatusCode::NOT_MODIFIED)
        .header(header::ETAG, etag)
        .header(header::CACHE_CONTROL, IMAGE_CACHE_CONTROL)
        .body(axum::body::Body::empty())
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

pub async fn serve_image_from(store: &BlobStore, id: &str, headers: &HeaderMap) -> Response {
    if !valid_id(id) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let etag = format!("\"{id}\"");
    let Some(path) = store.existing_path(BlobKind::Image, id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if if_none_match(headers, &etag) {
        return not_modified(&etag);
    }
    let Ok(Ok(bytes)) = tokio::task::spawn_blocking(move || std::fs::read(path)).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(mime) = sniff_image_type(&bytes) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    image_response(mime, &etag, bytes)
}

const IMAGE_CACHE_CONTROL: &str = "private, max-age=31536000, immutable";

pub(crate) fn image_response(mime: &str, etag: &str, bytes: Vec<u8>) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, bytes.len())
        .header(header::CACHE_CONTROL, IMAGE_CACHE_CONTROL)
        .header(header::ETAG, etag)
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer")
        // SVG stays inert even when opened directly (as the forge images).
        .header(
            "content-security-policy",
            "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        )
        .body(axum::body::Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// A request path as it may be logged: blob ids are capabilities, so they
/// never reach the logs.
pub fn redact_path(path: &str) -> std::borrow::Cow<'_, str> {
    for prefix in ["/api/img/", "/img/"] {
        if let Some(rest) = path.strip_prefix(prefix) {
            let id_len = rest.find(['/', '?']).unwrap_or(rest.len());
            return format!("{prefix}<id>{}", &rest[id_len..]).into();
        }
    }
    path.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_image_route_serves_images_by_id_only() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        let id = store.put(BlobKind::Image, PNG).unwrap();
        let none = HeaderMap::new();

        let ok = serve_image_from(&store, &id, &none).await;
        assert_eq!(ok.status(), StatusCode::OK);
        let h = ok.headers();
        assert_eq!(h[header::CONTENT_TYPE], "image/png");
        assert_eq!(h[header::CACHE_CONTROL], IMAGE_CACHE_CONTROL);
        assert_eq!(h[header::ETAG], format!("\"{id}\"").as_str());
        assert_eq!(h["x-content-type-options"], "nosniff");
        assert!(h["content-security-policy"]
            .to_str()
            .unwrap()
            .starts_with("sandbox"));

        let mut revalidate = HeaderMap::new();
        revalidate.insert(header::IF_NONE_MATCH, format!("\"{id}\"").parse().unwrap());
        assert_eq!(
            serve_image_from(&store, &id, &revalidate).await.status(),
            StatusCode::NOT_MODIFIED
        );

        // Not an image (a text blob, or bytes that do not sniff as one).
        let text = store.put(BlobKind::Text, b"secret tool output").unwrap();
        assert_eq!(
            serve_image_from(&store, &text, &none).await.status(),
            StatusCode::NOT_FOUND
        );
        let html = store
            .put(BlobKind::Image, b"<html><script>x</script>")
            .unwrap();
        assert_eq!(
            serve_image_from(&store, &html, &none).await.status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            serve_image_from(&store, "nope", &none).await.status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn thumbnails_fit_the_edge_and_flatten_transparency() {
        let img = image::RgbaImage::from_fn(2048, 1024, |x, _| {
            image::Rgba([0, 0, 0, if x < 1024 { 0 } else { 255 }])
        });
        let mut png = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let thumb = make_thumbnail(png.get_ref()).expect("a thumbnail");
        let decoded = image::load_from_memory(&thumb).unwrap().to_rgb8();
        assert_eq!(
            (decoded.width(), decoded.height()),
            (THUMB_EDGE, THUMB_EDGE / 2)
        );
        assert!(
            decoded.get_pixel(10, 10).0.iter().all(|&c| c > 240),
            "transparent became white"
        );
        assert!(
            decoded.get_pixel(500, 10).0.iter().all(|&c| c < 15),
            "opaque black stays black"
        );
        assert_eq!(sniff_image_type(&thumb), Some("image/jpeg"));

        assert!(wants_thumb(THUMB_MIN_BYTES, None));
        assert!(wants_thumb(10, Some((2000, 10))));
        assert!(!wants_thumb(10, Some((800, 600))));
        assert!(make_thumbnail(b"<svg xmlns='x'/>").is_none());
    }

    #[test]
    fn ids_never_reach_the_logs() {
        let id = "0123456789abcdef0123456789abcdef";
        assert_eq!(redact_path(&format!("/api/img/{id}")), "/api/img/<id>");
        assert_eq!(redact_path(&format!("/img/{id}")), "/img/<id>");
        assert_eq!(redact_path("/api/list_folders"), "/api/list_folders");
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n0000IHDR";

    #[test]
    fn ids_are_stable_keyed_and_kind_separated() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        let a = store.id_for(BlobKind::Image, PNG);
        assert!(valid_id(&a));
        assert_eq!(a, store.id_for(BlobKind::Image, PNG), "same bytes, same id");
        assert_ne!(
            a,
            store.id_for(BlobKind::Text, PNG),
            "kinds never share an id"
        );

        // Reopening keeps the key (ids survive a restart) ...
        let again = BlobStore::open(dir.path()).unwrap();
        assert_eq!(again.id_for(BlobKind::Image, PNG), a);
        // ... and another install's key gives other ids (not guessable from
        // the bytes alone).
        let other = tempfile::tempdir().unwrap();
        let elsewhere = BlobStore::open(other.path()).unwrap();
        assert_ne!(elsewhere.id_for(BlobKind::Image, PNG), a);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(dir.path().join(".key"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn put_then_read_and_reject_bad_ids() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        let id = store.put(BlobKind::Image, PNG).unwrap();
        assert_eq!(store.put(BlobKind::Image, PNG).unwrap(), id, "idempotent");
        assert_eq!(store.read(BlobKind::Image, &id).as_deref(), Some(PNG));
        assert!(
            store.read(BlobKind::Text, &id).is_none(),
            "an image id is not a text blob"
        );
        assert!(store.read(BlobKind::Image, "../../etc/passwd").is_none());
        assert!(store.read(BlobKind::Image, &id.to_uppercase()).is_none());
        assert!(store.read(BlobKind::Image, &"0".repeat(ID_LEN)).is_none());
    }

    #[test]
    fn prune_evicts_the_least_recently_read() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        let ids: Vec<String> = (0..5u8)
            .map(|i| store.put(BlobKind::Text, &[i; 100]).unwrap())
            .collect();
        // Age them in order, then read the oldest: it becomes the newest.
        for (i, id) in ids.iter().enumerate() {
            let path = store.path_of(id, BlobKind::Text);
            let at = SystemTime::now() - std::time::Duration::from_secs(1000 - i as u64);
            std::fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(at)
                .unwrap();
        }
        store.read(BlobKind::Text, &ids[0]).unwrap();

        store.prune_to(u64::MAX, 3).unwrap();
        let kept: Vec<bool> = ids
            .iter()
            .map(|id| store.read(BlobKind::Text, id).is_some())
            .collect();
        assert_eq!(kept, [true, false, false, true, true]);
        // Pruned blobs are stored again on the next put.
        assert_eq!(store.put(BlobKind::Text, &[1; 100]).unwrap(), ids[1]);
        assert!(store.read(BlobKind::Text, &ids[1]).is_some());
    }

    #[test]
    fn sniffing_trusts_the_bytes_only() {
        assert_eq!(sniff_image_type(PNG), Some("image/png"));
        assert_eq!(
            sniff_image_type(&[0xff, 0xd8, 0xff, 0xe0]),
            Some("image/jpeg")
        );
        assert_eq!(sniff_image_type(b"GIF89a...."), Some("image/gif"));
        assert_eq!(
            sniff_image_type(b"RIFF\0\0\0\0WEBPVP8 "),
            Some("image/webp")
        );
        assert_eq!(
            sniff_image_type(b"<?xml version=\"1.0\"?><svg xmlns=\"x\"/>"),
            Some("image/svg+xml")
        );
        assert_eq!(sniff_image_type(b"<html><script>alert(1)</script>"), None);
        assert_eq!(sniff_image_type(b"%PDF-1.7"), None);
    }
}
