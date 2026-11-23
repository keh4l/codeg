//! Images by reference in conversation responses (fork).
//!
//! A client that asks for `imageRefs` gets each inline image of a
//! conversation detail replaced by a reference to the blob store
//! (`web::blob_store`):
//!
//! ```json
//! {"mime_type":"image/png","blob":{"id":"<32 hex>","bytes":571234,"w":1920,"h":1080}}
//! ```
//!
//! in place of `{"mime_type":"image/png","data":"<base64>"}`. It then loads
//! the image from `GET /api/img/{id}` — once: the URL never changes, so the
//! browser's cache serves every later open. Everything else in the response
//! is untouched, and a client that does not ask gets inline data as before.
//!
//! The projection works on the serialized JSON, at the response boundary, so
//! the models, the parsers and every other consumer (desktop IPC, search,
//! export on the server, token usage) see the images exactly as before. Every
//! image shape the models have — `ImageData` (`image_generation.image`,
//! `tool_result.images[]`, tool-call images) and the `image` content / user
//! blocks — is an object with a base64 `data` string and an `image/*`
//! `mime_type`, which is what it looks for.

use base64::Engine as _;
use serde_json::{json, Map, Value};

use super::blob_store::{BlobKind, BlobStore};

/// Images smaller than this (base64 characters) stay inline: a request per
/// icon would cost more than it saves.
pub const MIN_INLINE_REF_CHARS: usize = 2 * 1024;

/// Replace inline images in `value` with blob references. Returns how many
/// were replaced. An image that does not decode stays inline.
pub fn project_images(value: &mut Value, store: &BlobStore) -> usize {
    let mut replaced = 0;
    visit(value, store, &mut replaced);
    replaced
}

fn visit(value: &mut Value, store: &BlobStore, replaced: &mut usize) {
    match value {
        Value::Object(map) => {
            if is_inline_image(map) {
                if replace(map, store) {
                    *replaced += 1;
                }
                return;
            }
            for child in map.values_mut() {
                visit(child, store, replaced);
            }
        }
        Value::Array(items) => {
            for item in items {
                visit(item, store, replaced);
            }
        }
        _ => {}
    }
}

fn is_inline_image(map: &Map<String, Value>) -> bool {
    let Some(Value::String(data)) = map.get("data") else {
        return false;
    };
    let Some(Value::String(mime)) = map.get("mime_type") else {
        return false;
    };
    mime.starts_with("image/") && data.len() >= MIN_INLINE_REF_CHARS
}

fn replace(map: &mut Map<String, Value>, store: &BlobStore) -> bool {
    let Some(Value::String(data)) = map.get("data") else {
        return false;
    };
    let Some(bytes) = decode(data) else {
        return false;
    };
    let id = match store.put(BlobKind::Image, &bytes) {
        Ok(id) => id,
        Err(err) => {
            tracing::warn!("[image-refs] keeping an image inline: {err}");
            return false;
        }
    };
    let mut blob = json!({ "id": id, "bytes": bytes.len() });
    let dims = dimensions(&bytes);
    if let Some((w, h)) = dims {
        blob["w"] = json!(w);
        blob["h"] = json!(h);
    }
    if super::blob_store::wants_thumb(bytes.len(), dims) {
        blob["thumb"] = json!(true);
    }
    map.remove("data");
    map.insert("blob".into(), blob);
    true
}

/// Base64 (standard, padded or not, whitespace tolerated), or a `data:` URL.
fn decode(data: &str) -> Option<Vec<u8>> {
    let payload = match data.strip_prefix("data:") {
        Some(rest) => rest.split_once(";base64,")?.1,
        None => data,
    };
    let engine = base64::engine::GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent),
    );
    match engine.decode(payload) {
        Ok(bytes) => Some(bytes),
        Err(_) => {
            let compact: String = payload
                .chars()
                .filter(|c| !c.is_ascii_whitespace())
                .collect();
            engine.decode(compact).ok()
        }
    }
}

/// Width and height from the image header (nothing is decoded).
fn dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

/// A handler's JSON response, with images as references and long tool bodies
/// shortened (`web::body_caps`) when the client asked for them (and the store
/// is available). Serializing and projecting a detail with megabytes of
/// base64 runs on a blocking thread.
pub async fn respond<T>(
    value: T,
    image_refs: bool,
    tool_bodies: bool,
) -> Result<axum::response::Response, crate::app_error::AppCommandError>
where
    T: serde::Serialize + Send + 'static,
{
    use axum::response::IntoResponse as _;
    let store = match (image_refs || tool_bodies, super::blob_store::global()) {
        (true, Some(store)) => store,
        _ => return Ok(axum::Json(value).into_response()),
    };
    let projected = tokio::task::spawn_blocking(move || {
        let mut json = serde_json::to_value(&value)?;
        if image_refs {
            project_images(&mut json, store);
        }
        if tool_bodies {
            super::body_caps::project_turn_bodies(&mut json, store);
        }
        Ok::<_, serde_json::Error>(json)
    })
    .await
    .map_err(|e| crate::app_error::AppCommandError::io_error(e.to_string()))?
    .map_err(|e| crate::app_error::AppCommandError::io_error(e.to_string()))?;
    Ok(axum::Json(projected).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A noisy PNG (noise does not compress, so its base64 is big enough to
    /// be referenced).
    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut x: u32 = 0x9e37_79b9;
        let img = image::RgbImage::from_fn(w, h, |_, _| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            let [r, g, b, _] = x.to_le_bytes();
            image::Rgb([r, g, b])
        });
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn every_image_shape_becomes_a_reference() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        let bytes = png(64, 40);
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        assert!(b64.len() >= MIN_INLINE_REF_CHARS);
        let mut detail = json!({
            "turns": [
                { "blocks": [
                    { "type": "text", "text": "look" },
                    { "type": "image", "data": b64, "mime_type": "image/png" },
                    { "type": "image_generation", "image": { "data": b64, "mime_type": "image/png" } },
                    { "type": "tool_result", "images": [ { "data": format!("data:image/png;base64,{b64}"), "mime_type": "image/png" } ] },
                    { "type": "image", "data": "aWNvbg==", "mime_type": "image/png" },
                    { "type": "text", "data": b64, "mime_type": "text/plain" },
                ] }
            ]
        });
        assert_eq!(project_images(&mut detail, &store), 3);
        let blocks = &detail["turns"][0]["blocks"];
        let id = blocks[1]["blob"]["id"].as_str().unwrap().to_string();
        assert!(blocks[1].get("data").is_none());
        assert_eq!(blocks[1]["mime_type"], "image/png");
        assert_eq!(blocks[1]["blob"]["bytes"], bytes.len());
        assert_eq!(blocks[1]["blob"]["w"], 64);
        assert_eq!(blocks[1]["blob"]["h"], 40);
        assert_eq!(
            blocks[2]["image"]["blob"]["id"],
            id.as_str(),
            "same bytes, same id"
        );
        assert_eq!(
            blocks[3]["images"][0]["blob"]["id"],
            id.as_str(),
            "a data: URL decodes too"
        );
        assert_eq!(blocks[4]["data"], "aWNvbg==", "a tiny image stays inline");
        assert!(blocks[5].get("blob").is_none(), "only images");
        assert_eq!(store.read(BlobKind::Image, &id).unwrap(), bytes);
    }

    #[test]
    fn an_image_that_does_not_decode_stays_inline() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        let bad = "!".repeat(MIN_INLINE_REF_CHARS);
        let mut v = json!({ "type": "image", "data": bad, "mime_type": "image/png" });
        assert_eq!(project_images(&mut v, &store), 0);
        assert_eq!(v["data"], bad.as_str());
    }
}
