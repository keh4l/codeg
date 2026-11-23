//! `/ws/events` protocol v2 framing (fork).
//!
//! A client that offers the `codeg-events.v2` subprotocol (and the server
//! selects it) receives:
//!
//! - **Text message**: one complete JSON frame, exactly as in v1. Frames
//!   under [`COMPRESS_MIN_BYTES`] go out this way.
//! - **Binary message**: byte 0 is a tag, the rest is a piece of a zlib
//!   stream (RFC 1950) whose decompressed bytes are one JSON frame, UTF-8:
//!   - `0x01` ([`TAG_WHOLE`]): the whole stream;
//!   - `0x02` ([`TAG_PART`]): a part, more follow;
//!   - `0x03` ([`TAG_LAST`]): the last part.
//!
//!   The parts of one frame are consecutive among binary messages, and no
//!   part carries more than [`PART_BYTES`] of the stream. Text messages may
//!   arrive between parts: the writer lets pongs and detaches through so a
//!   large frame never holds the client's liveness check hostage. A text
//!   message is complete on its own and is not part of the frame being
//!   assembled.
//!
//! Other tag values are reserved; a client drops a message it cannot read.
//! v1 clients (`codeg-events`) get every frame as one text message, as
//! before. The client also sends `coalesce_ms` on `attach` to choose the
//! merge window for streamed text (`ws_attach::DEFAULT_COALESCE_MS` when
//! absent; any server ignores fields it does not know).

use std::io::Write as _;

use axum::extract::ws::Message;
use flate2::write::ZlibEncoder;
use flate2::Compression;

/// The v2 subprotocol. MUST match `CODEG_WS_PROTOCOL_V2` in
/// `src/lib/transport/constants.ts`.
pub const WS_EVENT_PROTOCOL_V2: &str = "codeg-events.v2";

/// Frames at least this long (serialized) are compressed. Below it zlib
/// saves too little to be worth a binary message and a decode on the client.
pub const COMPRESS_MIN_BYTES: usize = 4 * 1024;

/// Most compressed bytes in one binary message. Small enough that a pong
/// queued behind one waits for at most this much on the wire.
pub const PART_BYTES: usize = 32 * 1024;

/// Frames at least this long are compressed on a blocking thread: the server
/// runtime may have one worker, and compressing a multi-megabyte snapshot
/// inline would stall every other socket on it.
pub const BLOCKING_COMPRESS_MIN_BYTES: usize = 256 * 1024;

/// Frames at least this long use the fastest zlib level.
const FAST_COMPRESS_MIN_BYTES: usize = 1024 * 1024;

pub const TAG_WHOLE: u8 = 0x01;
pub const TAG_PART: u8 = 0x02;
pub const TAG_LAST: u8 = 0x03;

/// How a socket's frames are written, chosen at the upgrade.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    /// `codeg-events`: one text message per frame.
    V1,
    /// `codeg-events.v2`: large frames compressed and split.
    V2,
}

impl Codec {
    /// The codec for the subprotocol the server selected.
    pub fn from_selected(protocol: Option<&str>) -> Self {
        if protocol == Some(WS_EVENT_PROTOCOL_V2) {
            Codec::V2
        } else {
            Codec::V1
        }
    }
}

/// The messages that carry one serialized frame, in order.
pub async fn encode(text: String, codec: Codec) -> Vec<Message> {
    if codec == Codec::V1 || text.len() < COMPRESS_MIN_BYTES {
        return vec![Message::Text(text.into())];
    }
    let compressed = if text.len() >= BLOCKING_COMPRESS_MIN_BYTES {
        match tokio::task::spawn_blocking(move || compress(text.as_bytes())).await {
            Ok(bytes) => bytes,
            // The blocking pool is gone (runtime shutting down); nothing
            // will be written anyway.
            Err(_) => return Vec::new(),
        }
    } else {
        compress(text.as_bytes())
    };
    split(&compressed)
}

/// zlib (RFC 1950) of `bytes`.
pub fn compress(bytes: &[u8]) -> Vec<u8> {
    let level = if bytes.len() >= FAST_COMPRESS_MIN_BYTES {
        Compression::fast()
    } else {
        Compression::new(3)
    };
    let mut encoder = ZlibEncoder::new(Vec::with_capacity(bytes.len() / 4), level);
    // Writing into a Vec cannot fail.
    encoder.write_all(bytes).expect("zlib into memory");
    encoder.finish().expect("zlib into memory")
}

/// Tagged binary messages carrying `stream`.
pub fn split(stream: &[u8]) -> Vec<Message> {
    let tagged = |tag: u8, piece: &[u8]| {
        let mut bytes = Vec::with_capacity(piece.len() + 1);
        bytes.push(tag);
        bytes.extend_from_slice(piece);
        Message::Binary(bytes.into())
    };
    if stream.len() <= PART_BYTES {
        return vec![tagged(TAG_WHOLE, stream)];
    }
    let pieces: Vec<&[u8]> = stream.chunks(PART_BYTES).collect();
    let last = pieces.len() - 1;
    pieces
        .into_iter()
        .enumerate()
        .map(|(i, piece)| tagged(if i == last { TAG_LAST } else { TAG_PART }, piece))
        .collect()
}

/// Largest frame a client inflates; past it the frame is treated as corrupt
/// rather than exhausting memory.
pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

/// A v2 binary message that could not be turned into a frame.
#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("compressed frame did not inflate: {0}")]
    Inflate(std::io::Error),
    #[error("frame larger than {MAX_FRAME_BYTES} bytes")]
    TooLarge,
    #[error("frame is not UTF-8")]
    NotUtf8,
}

/// The receiving side of v2 for a Rust client (the desktop's proxy to a
/// remote server): binary messages in, complete JSON frames out. Text
/// messages are frames already and do not go through it.
#[derive(Debug, Default)]
pub struct FrameJoiner {
    stream: Vec<u8>,
}

impl FrameJoiner {
    /// Feed one binary message. `Some` once a frame is complete (or failed);
    /// `None` while more parts are due, or for a reserved tag (dropped).
    pub fn push(&mut self, message: &[u8]) -> Option<Result<String, FrameError>> {
        let (&tag, body) = message.split_first()?;
        match tag {
            TAG_WHOLE => {
                self.stream.clear();
                Some(inflate(body))
            }
            TAG_PART => {
                if self.stream.len() + body.len() > MAX_FRAME_BYTES {
                    self.stream.clear();
                    return Some(Err(FrameError::TooLarge));
                }
                self.stream.extend_from_slice(body);
                None
            }
            TAG_LAST => {
                self.stream.extend_from_slice(body);
                let stream = std::mem::take(&mut self.stream);
                Some(inflate(&stream))
            }
            _ => None,
        }
    }

    /// Forget a partly received frame (the socket is gone).
    pub fn reset(&mut self) {
        self.stream.clear();
    }
}

/// Inflate one zlib stream into a frame's text, bounded by `MAX_FRAME_BYTES`.
pub fn inflate(stream: &[u8]) -> Result<String, FrameError> {
    use std::io::Read as _;
    let mut out = Vec::with_capacity(stream.len().saturating_mul(4));
    flate2::read::ZlibDecoder::new(stream)
        .take(MAX_FRAME_BYTES as u64 + 1)
        .read_to_end(&mut out)
        .map_err(FrameError::Inflate)?;
    if out.len() > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge);
    }
    String::from_utf8(out).map_err(|_| FrameError::NotUtf8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::ZlibDecoder;
    use std::io::Read as _;

    /// What a v2 client does: join the parts, inflate.
    fn decode(messages: &[Message]) -> String {
        let mut stream = Vec::new();
        for (i, message) in messages.iter().enumerate() {
            match message {
                Message::Text(text) => {
                    assert_eq!(messages.len(), 1);
                    return text.to_string();
                }
                Message::Binary(bytes) => {
                    let expected = match (messages.len(), i + 1 == messages.len()) {
                        (1, _) => TAG_WHOLE,
                        (_, true) => TAG_LAST,
                        _ => TAG_PART,
                    };
                    assert_eq!(bytes[0], expected, "message {i}");
                    assert!(bytes.len() - 1 <= PART_BYTES);
                    stream.extend_from_slice(&bytes[1..]);
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        let mut out = String::new();
        ZlibDecoder::new(&stream[..])
            .read_to_string(&mut out)
            .unwrap();
        out
    }

    fn json_of(len: usize) -> String {
        let mut s = String::from("{\"type\":\"event\",\"text\":\"");
        let mut i = 0u64;
        while s.len() < len {
            s.push_str(&format!("line {i} of output, "));
            i += 1;
        }
        s.push_str("\"}");
        s
    }

    #[tokio::test]
    async fn v1_sends_every_frame_as_one_text_message() {
        let big = json_of(500 * 1024);
        let messages = encode(big.clone(), Codec::V1).await;
        assert_eq!(messages.len(), 1);
        assert_eq!(decode(&messages), big);
    }

    #[tokio::test]
    async fn v2_keeps_small_frames_as_text() {
        let small = json_of(COMPRESS_MIN_BYTES - 100);
        let messages = encode(small.clone(), Codec::V2).await;
        assert!(matches!(messages[..], [Message::Text(_)]));
        assert_eq!(decode(&messages), small);
    }

    #[tokio::test]
    async fn v2_compresses_into_one_message_or_tagged_parts() {
        let medium = json_of(20 * 1024);
        let messages = encode(medium.clone(), Codec::V2).await;
        assert_eq!(messages.len(), 1);
        assert_eq!(decode(&messages), medium);

        // Incompressible enough to need parts, and past the blocking size.
        let mut noisy = String::from("{\"data\":\"");
        let mut x: u64 = 0x2545_f491_4f6c_dd1d;
        while noisy.len() < 600 * 1024 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            noisy.push(char::from(b'A' + (x % 26) as u8));
        }
        noisy.push_str("\"}");
        let messages = encode(noisy.clone(), Codec::V2).await;
        assert!(messages.len() > 2, "{} messages", messages.len());
        assert_eq!(decode(&messages), noisy);
    }

    #[tokio::test]
    async fn the_joiner_reads_what_encode_writes() {
        let big = json_of(300 * 1024);
        let mut joiner = FrameJoiner::default();
        let mut out = Vec::new();
        for message in encode(big.clone(), Codec::V2).await {
            let Message::Binary(bytes) = message else {
                panic!("binary expected")
            };
            if let Some(frame) = joiner.push(&bytes) {
                out.push(frame.unwrap());
            }
        }
        assert_eq!(out, vec![big]);

        // A reserved tag is dropped; garbage reports an error; a reset forgets
        // a half-received frame.
        assert!(joiner.push(&[0x7f, 1, 2]).is_none());
        assert!(matches!(
            joiner.push(&[TAG_WHOLE, 1, 2, 3]),
            Some(Err(FrameError::Inflate(_)))
        ));
        assert!(joiner.push(&[TAG_PART, 9, 9, 9]).is_none());
        joiner.reset();
        let small = compress(b"{\"ok\":true}");
        let mut last = vec![TAG_LAST];
        last.extend_from_slice(&small);
        assert_eq!(joiner.push(&last).unwrap().unwrap(), "{\"ok\":true}");
    }

    #[test]
    fn codec_follows_the_selected_subprotocol() {
        assert_eq!(Codec::from_selected(Some(WS_EVENT_PROTOCOL_V2)), Codec::V2);
        assert_eq!(Codec::from_selected(Some("codeg-events")), Codec::V1);
        assert_eq!(Codec::from_selected(None), Codec::V1);
    }
}
