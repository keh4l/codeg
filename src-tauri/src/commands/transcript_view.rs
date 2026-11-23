//! keh4l build: read-only views over a conversation's WHOLE parsed transcript
//! for the T3-style chat view — the in-thread find bar
//! ([`search_conversation_core`]) and the timeline minimap
//! ([`get_conversation_minimap_core`]).
//!
//! Both read the full turn list through the same light path as the history
//! pages and the message navigator's outline
//! ([`get_folder_conversation_core`]: full parse + delegation meta, no live
//! correlation, no sidebar events), so a result's `turn_index` is the global
//! index `turns_offset` / `loadOlderTurnsThrough` count in, and its `turn_id`
//! is that list's `MessageTurn.id`.

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::app_error::AppCommandError;
use crate::commands::conversations::get_folder_conversation_core;
#[cfg(feature = "tauri-runtime")]
use crate::db::AppDatabase;
use crate::models::message::{ContentBlock, MessageTurn, TurnRole};

const DEFAULT_SEARCH_LIMIT: u32 = 1000;
const MAX_SEARCH_LIMIT: u32 = 5000;
/// Characters of context kept on each side of a match in its snippet.
const SNIPPET_CONTEXT_CHARS: usize = 40;
const MINIMAP_PROMPT_CHARS: usize = 160;
const MINIMAP_REPLY_CHARS: usize = 240;
const ELLIPSIS: char = '…';

/// Which part of a turn a match was found in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchBlockKind {
    /// A `Text` block.
    Text = 0,
    /// A `Thinking` block.
    Thinking = 1,
    /// A `ToolUse` block's `input_preview`.
    ToolInput = 2,
    /// A `ToolResult` block's `output_preview`.
    ToolOutput = 3,
}

const BLOCK_KINDS: usize = 4;

#[derive(Debug, Clone, Serialize)]
pub struct ConversationSearchMatch {
    /// Index into the conversation's full turn list.
    pub turn_index: usize,
    pub turn_id: String,
    pub role: TurnRole,
    pub block: SearchBlockKind,
    /// 0-based position of this occurrence among the query's occurrences in
    /// the same turn's blocks of the same kind, in document order (the count
    /// runs on across a turn's several `Text` blocks).
    pub occurrence: usize,
    /// The match with up to [`SNIPPET_CONTEXT_CHARS`] characters of context on
    /// each side, whitespace runs collapsed to one space, `…` where cut.
    pub snippet: String,
    /// Char (Unicode scalar, not byte, not UTF-16) offsets of the match inside
    /// `snippet`, end exclusive.
    pub snippet_match_start: usize,
    pub snippet_match_end: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ConversationSearchResult {
    /// The first `limit` occurrences, in turn order then block order.
    pub matches: Vec<ConversationSearchMatch>,
    /// Every occurrence in the transcript, kept or not.
    pub total: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationMinimapEntry {
    /// Index into the conversation's full turn list.
    pub turn_index: usize,
    pub turn_id: String,
    pub timestamp: DateTime<Utc>,
    /// The user's first non-empty text, whitespace collapsed, at most
    /// [`MINIMAP_PROMPT_CHARS`] characters plus `…` when cut.
    pub prompt: String,
    /// The last non-empty assistant `Text` block before the next user message,
    /// whitespace collapsed, at most [`MINIMAP_REPLY_CHARS`] characters plus
    /// `…` when cut. `None` while (or when) nothing has answered.
    pub reply: Option<String>,
}

// ── Search ───────────────────────────────────────────────────────────────────

/// A query prepared once for a whole transcript.
///
/// Case-insensitive matching folds BOTH sides one character at a time with
/// `char::to_lowercase` (so no context-sensitive final-sigma rule): a client
/// that recounts occurrences in rendered text must fold the same way.
struct Needle {
    pattern: String,
    case_sensitive: bool,
}

impl Needle {
    /// `None` for an empty or whitespace-only query.
    fn new(query: &str, case_sensitive: bool) -> Option<Self> {
        if query.trim().is_empty() {
            return None;
        }
        let pattern = if case_sensitive {
            query.to_string()
        } else {
            fold(query)
        };
        Some(Self {
            pattern,
            case_sensitive,
        })
    }

    /// The byte ranges in `text` of every non-overlapping occurrence, in
    /// order, written into `out` (cleared first). Linear in `text`: the
    /// substring search is std's two-way matcher.
    fn find_all(&self, text: &str, out: &mut Vec<(usize, usize)>) {
        out.clear();
        let pattern = self.pattern.as_str();
        if self.case_sensitive {
            out.extend(
                text.match_indices(pattern)
                    .map(|(start, m)| (start, start + m.len())),
            );
        } else if text.is_ascii() {
            // Lowercasing ASCII leaves every byte where it was.
            let folded = text.to_ascii_lowercase();
            out.extend(
                folded
                    .match_indices(pattern)
                    .map(|(start, m)| (start, start + m.len())),
            );
        } else {
            let folded = FoldedText::new(text);
            for (start, m) in folded.text.match_indices(pattern) {
                let range = folded.original_range(start, start + m.len(), text.len());
                // A fold can expand one char into several; never report two
                // matches inside the same original char.
                if out.last().is_none_or(|&(_, prev_end)| range.0 >= prev_end) {
                    out.push(range);
                }
            }
        }
    }
}

fn fold(text: &str) -> String {
    text.chars().flat_map(char::to_lowercase).collect()
}

/// A per-char lowercase fold of a non-ASCII text, with the way back to the
/// original's byte offsets (a fold can change a char's byte length).
struct FoldedText {
    text: String,
    /// `(folded byte, original byte)` where each original char's fold starts.
    starts: Vec<(usize, usize)>,
}

impl FoldedText {
    fn new(original: &str) -> Self {
        let mut text = String::with_capacity(original.len());
        let mut starts = Vec::with_capacity(original.len() / 2);
        for (byte, c) in original.char_indices() {
            starts.push((text.len(), byte));
            text.extend(c.to_lowercase());
        }
        Self { text, starts }
    }

    /// The original byte range covering folded bytes `[start, end)`, widened
    /// to whole original chars.
    fn original_range(&self, start: usize, end: usize, original_len: usize) -> (usize, usize) {
        // The original char whose fold holds folded byte `start`. `starts[0]`
        // is `(0, 0)`, so the partition point is at least 1.
        let first = self.starts.partition_point(|&(f, _)| f <= start) - 1;
        // The first original char whose fold starts at or past `end`.
        let past = self.starts.partition_point(|&(f, _)| f < end);
        let end = self.starts.get(past).map_or(original_len, |&(_, o)| o);
        (self.starts[first].1, end)
    }
}

/// The searchable text of a block, if it has any.
fn searchable(block: &ContentBlock) -> Option<(SearchBlockKind, &str)> {
    match block {
        ContentBlock::Text { text } => Some((SearchBlockKind::Text, text)),
        ContentBlock::Thinking { text } => Some((SearchBlockKind::Thinking, text)),
        ContentBlock::ToolUse {
            input_preview: Some(input),
            ..
        } => Some((SearchBlockKind::ToolInput, input)),
        ContentBlock::ToolResult {
            output_preview: Some(output),
            ..
        } => Some((SearchBlockKind::ToolOutput, output)),
        _ => None,
    }
}

/// Every occurrence of `query` in `turns`, in turn order then block order.
/// Counts all of them; builds a match (and its snippet) for the first `limit`.
pub fn search_turns(
    turns: &[MessageTurn],
    query: &str,
    case_sensitive: bool,
    limit: usize,
) -> ConversationSearchResult {
    let Some(needle) = Needle::new(query, case_sensitive) else {
        return ConversationSearchResult::default();
    };
    let mut result = ConversationSearchResult::default();
    let mut ranges = Vec::new();
    for (turn_index, turn) in turns.iter().enumerate() {
        let mut seen = [0usize; BLOCK_KINDS];
        for block in &turn.blocks {
            let Some((kind, text)) = searchable(block) else {
                continue;
            };
            needle.find_all(text, &mut ranges);
            for &(start, end) in &ranges {
                let occurrence = seen[kind as usize];
                seen[kind as usize] += 1;
                result.total += 1;
                if result.matches.len() < limit {
                    let (snippet, snippet_match_start, snippet_match_end) =
                        build_snippet(text, start, end);
                    result.matches.push(ConversationSearchMatch {
                        turn_index,
                        turn_id: turn.id.clone(),
                        role: turn.role.clone(),
                        block: kind,
                        occurrence,
                        snippet,
                        snippet_match_start,
                        snippet_match_end,
                    });
                }
            }
        }
    }
    result.truncated = result.total > result.matches.len();
    result
}

/// `text[start..end]` (byte offsets on char boundaries) with up to
/// [`SNIPPET_CONTEXT_CHARS`] chars of context on each side. Returns the
/// snippet and the match's char offsets inside it.
fn build_snippet(text: &str, start: usize, end: usize) -> (String, usize, usize) {
    let window_start = text[..start]
        .char_indices()
        .rev()
        .take(SNIPPET_CONTEXT_CHARS)
        .last()
        .map_or(start, |(i, _)| i);
    let window_end = text[end..]
        .char_indices()
        .nth(SNIPPET_CONTEXT_CHARS)
        .map_or(text.len(), |(i, _)| end + i);

    let mut out = Snippet::default();
    if window_start > 0 {
        out.push(ELLIPSIS);
    }
    out.push_collapsed(text[window_start..start].trim_start());
    let match_start = out.chars;
    out.push_collapsed(&text[start..end]);
    let match_end = out.chars;
    out.push_collapsed(text[end..window_end].trim_end());
    if window_end < text.len() {
        out.push(ELLIPSIS);
    }
    (out.text, match_start, match_end)
}

#[derive(Default)]
struct Snippet {
    text: String,
    chars: usize,
}

impl Snippet {
    fn push(&mut self, c: char) {
        self.text.push(c);
        self.chars += 1;
    }

    /// Append `part` with each whitespace run turned into one space. Runs are
    /// collapsed within a part only, so the match keeps every char it has.
    fn push_collapsed(&mut self, part: &str) {
        let mut in_space = false;
        for c in part.chars() {
            if c.is_whitespace() {
                if !in_space {
                    self.push(' ');
                }
                in_space = true;
            } else {
                self.push(c);
                in_space = false;
            }
        }
    }
}

fn resolve_search_limit(limit: Option<u32>) -> usize {
    limit.unwrap_or(DEFAULT_SEARCH_LIMIT).min(MAX_SEARCH_LIMIT) as usize
}

/// Full-text search over a conversation's whole transcript, not just the
/// loaded window.
pub async fn search_conversation_core(
    conn: &sea_orm::DatabaseConnection,
    conversation_id: i32,
    query: String,
    case_sensitive: bool,
    limit: Option<u32>,
) -> Result<ConversationSearchResult, AppCommandError> {
    if query.trim().is_empty() {
        return Ok(ConversationSearchResult::default());
    }
    let limit = resolve_search_limit(limit);
    let (detail, _parsed_title) = get_folder_conversation_core(conn, conversation_id).await?;
    let turns = detail.turns;
    tokio::task::spawn_blocking(move || search_turns(&turns, &query, case_sensitive, limit))
        .await
        .map_err(|e| {
            AppCommandError::task_execution_failed("Failed to search the conversation")
                .with_detail(e.to_string())
        })
}

// ── Minimap ──────────────────────────────────────────────────────────────────

/// A turn the user sent: a `User` turn holding anything besides tool results
/// (a parser that leaves a tool-result-only record as its own user turn has
/// not started a new exchange).
fn is_user_message(turn: &MessageTurn) -> bool {
    matches!(turn.role, TurnRole::User)
        && turn
            .blocks
            .iter()
            .any(|b| !matches!(b, ContentBlock::ToolResult { .. }))
}

fn non_empty_texts(turn: &MessageTurn) -> impl DoubleEndedIterator<Item = &str> {
    turn.blocks.iter().filter_map(|b| match b {
        ContentBlock::Text { text } if !text.trim().is_empty() => Some(text.as_str()),
        _ => None,
    })
}

/// `text` with whitespace runs collapsed to one space and trimmed, cut to
/// `max_chars` characters with `…` appended when anything was left out.
fn collapse_and_clip(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut count = 0usize;
    for (i, word) in text.split_whitespace().enumerate() {
        if i > 0 {
            if count == max_chars {
                return cut(out);
            }
            out.push(' ');
            count += 1;
        }
        for c in word.chars() {
            if count == max_chars {
                return cut(out);
            }
            out.push(c);
            count += 1;
        }
    }
    out
}

fn cut(mut out: String) -> String {
    out.truncate(out.trim_end().len());
    out.push(ELLIPSIS);
    out
}

/// One entry per user message with visible text, in order.
pub fn minimap_entries(turns: &[MessageTurn]) -> Vec<ConversationMinimapEntry> {
    fn attach_reply(
        entries: &mut [ConversationMinimapEntry],
        open: Option<usize>,
        reply: Option<&str>,
    ) {
        if let (Some(i), Some(text)) = (open, reply) {
            entries[i].reply = Some(collapse_and_clip(text, MINIMAP_REPLY_CHARS));
        }
    }

    let mut entries: Vec<ConversationMinimapEntry> = Vec::new();
    // The entry collecting a reply, and the latest reply text seen for it
    // (clipped once, when the exchange closes).
    let mut open: Option<usize> = None;
    let mut reply: Option<&str> = None;
    for (turn_index, turn) in turns.iter().enumerate() {
        if is_user_message(turn) {
            attach_reply(&mut entries, open, reply);
            reply = None;
            open = non_empty_texts(turn).next().map(|text| {
                entries.push(ConversationMinimapEntry {
                    turn_index,
                    turn_id: turn.id.clone(),
                    timestamp: turn.timestamp,
                    prompt: collapse_and_clip(text, MINIMAP_PROMPT_CHARS),
                    reply: None,
                });
                entries.len() - 1
            });
        } else if matches!(turn.role, TurnRole::Assistant) && open.is_some() {
            if let Some(text) = non_empty_texts(turn).next_back() {
                reply = Some(text);
            }
        }
    }
    attach_reply(&mut entries, open, reply);
    entries
}

/// One entry per user message of the whole conversation, for the timeline
/// minimap and its hover previews.
pub async fn get_conversation_minimap_core(
    conn: &sea_orm::DatabaseConnection,
    conversation_id: i32,
) -> Result<Vec<ConversationMinimapEntry>, AppCommandError> {
    let (detail, _parsed_title) = get_folder_conversation_core(conn, conversation_id).await?;
    Ok(minimap_entries(&detail.turns))
}

/// A conversation detail with the minimap's list alongside (fork): what a
/// client opening a long conversation would otherwise ask for in a second
/// round trip once the window arrived.
#[derive(Debug, Serialize)]
pub struct DetailWithMinimap {
    #[serde(flatten)]
    pub detail: crate::models::DbConversationDetail,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimap: Option<Vec<ConversationMinimapEntry>>,
}

/// `detail` (a windowed detail read), with the minimap's list read alongside
/// when `wanted`. The list is sent only when the window does not start at the
/// first turn — otherwise the loaded turns are the whole history and the
/// client draws the minimap from them. A list that fails to read is left out;
/// the client then asks for it as before. Both reads parse the same
/// transcript, which the detail cache (`commands::detail_cache`) turns into
/// one parse for Claude Code.
pub async fn with_minimap(
    conn: &sea_orm::DatabaseConnection,
    conversation_id: i32,
    wanted: bool,
    detail: impl std::future::Future<
        Output = Result<crate::models::DbConversationDetail, AppCommandError>,
    >,
) -> Result<DetailWithMinimap, AppCommandError> {
    let minimap = async {
        if wanted {
            get_conversation_minimap_core(conn, conversation_id).await.ok()
        } else {
            None
        }
    };
    let (detail, minimap) = tokio::join!(detail, minimap);
    let detail = detail?;
    let minimap = minimap.filter(|_| detail.turns_offset.is_some_and(|offset| offset > 0));
    Ok(DetailWithMinimap { detail, minimap })
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn search_conversation(
    db: tauri::State<'_, AppDatabase>,
    conversation_id: i32,
    query: String,
    case_sensitive: bool,
    limit: Option<u32>,
) -> Result<ConversationSearchResult, AppCommandError> {
    search_conversation_core(&db.conn, conversation_id, query, case_sensitive, limit).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_conversation_minimap(
    db: tauri::State<'_, AppDatabase>,
    conversation_id: i32,
) -> Result<Vec<ConversationMinimapEntry>, AppCommandError> {
    get_conversation_minimap_core(&db.conn, conversation_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-22T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn turn(index: usize, role: TurnRole, blocks: Vec<ContentBlock>) -> MessageTurn {
        MessageTurn {
            id: format!("turn-{index}"),
            role,
            blocks,
            timestamp: ts(),
            usage: None,
            duration_ms: None,
            model: None,
            completed_at: None,
            agent_message_id: None,
        }
    }

    fn text(s: &str) -> ContentBlock {
        ContentBlock::Text { text: s.into() }
    }

    fn thinking(s: &str) -> ContentBlock {
        ContentBlock::Thinking { text: s.into() }
    }

    fn tool_use(input: &str) -> ContentBlock {
        ContentBlock::ToolUse {
            tool_use_id: Some("call-1".into()),
            tool_name: "Bash".into(),
            input_preview: Some(input.into()),
            status: None,
            meta: None,
        }
    }

    fn tool_result(output: &str) -> ContentBlock {
        ContentBlock::ToolResult {
            tool_use_id: Some("call-1".into()),
            output_preview: Some(output.into()),
            is_error: false,
            agent_stats: None,
            images: Vec::new(),
            exit_code: None,
        }
    }

    fn image() -> ContentBlock {
        ContentBlock::Image {
            data: "needle".into(),
            mime_type: "image/png".into(),
            uri: None,
        }
    }

    /// The matched text as the snippet offsets name it.
    fn highlighted(m: &ConversationSearchMatch) -> String {
        m.snippet
            .chars()
            .skip(m.snippet_match_start)
            .take(m.snippet_match_end - m.snippet_match_start)
            .collect()
    }

    #[test]
    fn case_insensitive_ascii_finds_every_spelling() {
        let turns = vec![
            turn(0, TurnRole::User, vec![text("Find the NEEDLE")]),
            turn(1, TurnRole::Assistant, vec![text("a needle, a Needle")]),
        ];
        let r = search_turns(&turns, "needle", false, 100);
        assert_eq!(r.total, 3);
        assert!(!r.truncated);
        let got: Vec<_> = r
            .matches
            .iter()
            .map(|m| (m.turn_index, m.turn_id.as_str(), highlighted(m)))
            .collect();
        assert_eq!(
            got,
            vec![
                (0, "turn-0", "NEEDLE".to_string()),
                (1, "turn-1", "needle".to_string()),
                (1, "turn-1", "Needle".to_string()),
            ]
        );
        assert!(matches!(r.matches[0].role, TurnRole::User));
        assert!(matches!(r.matches[1].role, TurnRole::Assistant));
        assert_eq!(r.matches[0].snippet, "Find the NEEDLE");
        assert_eq!(
            (
                r.matches[0].snippet_match_start,
                r.matches[0].snippet_match_end
            ),
            (9, 15)
        );
        // An uppercase query folds too.
        assert_eq!(search_turns(&turns, "NeEdLe", false, 100).total, 3);
    }

    #[test]
    fn case_sensitive_only_matches_the_exact_spelling() {
        let turns = vec![turn(
            0,
            TurnRole::Assistant,
            vec![text("Needle needle NEEDLE")],
        )];
        let r = search_turns(&turns, "Needle", true, 100);
        assert_eq!(r.total, 1);
        assert_eq!(highlighted(&r.matches[0]), "Needle");
        assert_eq!(r.matches[0].snippet_match_start, 0);
        assert_eq!(search_turns(&turns, "needle", true, 100).total, 1);
        assert_eq!(search_turns(&turns, "nEEDLE", true, 100).total, 0);
    }

    #[test]
    fn cjk_query_matches_by_character() {
        let turns = vec![
            turn(
                0,
                TurnRole::User,
                vec![text("请帮我修复搜索功能，搜索很慢")],
            ),
            turn(1, TurnRole::Assistant, vec![text("好的，我来看看「搜索」")]),
        ];
        let r = search_turns(&turns, "搜索", false, 100);
        assert_eq!(r.total, 3);
        assert!(r.matches.iter().all(|m| highlighted(m) == "搜索"));
        assert_eq!(
            (
                r.matches[0].snippet_match_start,
                r.matches[0].snippet_match_end
            ),
            (5, 7)
        );
        assert_eq!(r.matches[1].occurrence, 1);
        // Mixed-script text, case-insensitive: the CJK side still lines up.
        let mixed = vec![turn(0, TurnRole::User, vec![text("修复 Ünïcode 搜索 BUG")])];
        let r = search_turns(&mixed, "ünïcode 搜索 bug", false, 100);
        assert_eq!(r.total, 1);
        assert_eq!(highlighted(&r.matches[0]), "Ünïcode 搜索 BUG");
    }

    #[test]
    fn a_fold_that_changes_byte_length_maps_back_to_the_original() {
        // 'İ' (2 bytes) lowercases to "i̇" (3 bytes) and the Kelvin sign (3
        // bytes) to an ASCII 'k': offsets after them shift in the fold.
        let turns = vec![turn(
            0,
            TurnRole::User,
            vec![text("İstanbul \u{212A}ilo needle")],
        )];
        let r = search_turns(&turns, "needle", false, 100);
        assert_eq!(r.total, 1);
        assert_eq!(highlighted(&r.matches[0]), "needle");
        let r = search_turns(&turns, "kilo", false, 100);
        assert_eq!(r.total, 1);
        assert_eq!(highlighted(&r.matches[0]), "\u{212A}ilo");
        // A query matching part of one char's expansion highlights the char.
        let r = search_turns(&turns, "i", false, 100);
        assert_eq!(highlighted(&r.matches[0]), "İ");
    }

    #[test]
    fn a_multibyte_char_at_the_snippet_cut_is_kept_whole() {
        let before = "汉".repeat(50);
        let after = "😀".repeat(50);
        let body = format!("{before}\nneedle\n{after}");
        let turns = vec![turn(0, TurnRole::Assistant, vec![text(&body)])];
        let r = search_turns(&turns, "NEEDLE", false, 100);
        assert_eq!(r.total, 1);
        let m = &r.matches[0];
        // "…" + 39 汉 + " " (the newline) | needle | " " + 39 😀 + "…"
        let expected = format!(
            "{ELLIPSIS}{} needle {}{ELLIPSIS}",
            "汉".repeat(39),
            "😀".repeat(39)
        );
        assert_eq!(m.snippet, expected);
        assert_eq!((m.snippet_match_start, m.snippet_match_end), (41, 47));
        assert_eq!(highlighted(m), "needle");
    }

    #[test]
    fn snippet_collapses_whitespace_and_cuts_with_an_ellipsis() {
        let body = format!("{}\n\n\tneedle\r\n  tail", "x".repeat(60));
        let turns = vec![turn(0, TurnRole::Assistant, vec![text(&body)])];
        let m = &search_turns(&turns, "needle", false, 100).matches[0];
        assert_eq!(
            m.snippet,
            format!("{ELLIPSIS}{} needle tail", "x".repeat(37))
        );
        assert_eq!(highlighted(m), "needle");
    }

    #[test]
    fn occurrences_number_per_turn_and_block_kind() {
        let turns = vec![
            turn(
                0,
                TurnRole::Assistant,
                vec![
                    thinking("needle in thought"),
                    text("needle one, needle two"),
                    tool_use(r#"{"command":"grep needle"}"#),
                    text("needle three"),
                    thinking("another needle"),
                ],
            ),
            turn(1, TurnRole::Assistant, vec![text("needle again")]),
        ];
        let r = search_turns(&turns, "needle", false, 100);
        let got: Vec<_> = r
            .matches
            .iter()
            .map(|m| (m.turn_index, m.block, m.occurrence))
            .collect();
        use SearchBlockKind::*;
        assert_eq!(
            got,
            vec![
                (0, Thinking, 0),
                (0, Text, 0),
                (0, Text, 1),
                (0, ToolInput, 0),
                // The count runs on across the turn's second text block…
                (0, Text, 2),
                (0, Thinking, 1),
                // …and starts over in the next turn.
                (1, Text, 0),
            ]
        );
    }

    #[test]
    fn non_overlapping_occurrences() {
        let turns = vec![turn(0, TurnRole::Assistant, vec![text("aaaa")])];
        assert_eq!(search_turns(&turns, "aa", false, 100).total, 2);
    }

    #[test]
    fn limit_caps_the_matches_but_not_the_total() {
        let turns: Vec<_> = (0..10)
            .map(|i| turn(i, TurnRole::Assistant, vec![text("needle needle")]))
            .collect();
        let r = search_turns(&turns, "needle", false, 5);
        assert_eq!(r.total, 20);
        assert_eq!(r.matches.len(), 5);
        assert!(r.truncated);
        assert_eq!(r.matches[4].turn_index, 2);
        let all = search_turns(&turns, "needle", false, 20);
        assert_eq!(all.matches.len(), 20);
        assert!(!all.truncated);
        assert_eq!(resolve_search_limit(None), 1000);
        assert_eq!(resolve_search_limit(Some(10)), 10);
        assert_eq!(resolve_search_limit(Some(1_000_000)), 5000);
    }

    #[test]
    fn empty_or_whitespace_query_finds_nothing() {
        let turns = vec![turn(0, TurnRole::User, vec![text("a b  c")])];
        for q in ["", " ", "  \n\t"] {
            let r = search_turns(&turns, q, false, 100);
            assert_eq!(r.total, 0, "{q:?}");
            assert!(r.matches.is_empty());
            assert!(!r.truncated);
        }
    }

    #[test]
    fn tool_output_is_searched_and_images_are_not() {
        let turns = vec![
            turn(0, TurnRole::User, vec![image()]),
            turn(
                1,
                TurnRole::Assistant,
                vec![
                    tool_use("ls"),
                    tool_result("src/\nNeedle.rs\nmain.rs"),
                    ContentBlock::ToolResult {
                        tool_use_id: None,
                        output_preview: None,
                        is_error: true,
                        agent_stats: None,
                        images: Vec::new(),
                        exit_code: None,
                    },
                ],
            ),
        ];
        let r = search_turns(&turns, "needle", false, 100);
        assert_eq!(r.total, 1);
        let m = &r.matches[0];
        assert_eq!((m.turn_index, m.block), (1, SearchBlockKind::ToolOutput));
        assert_eq!(m.snippet, "src/ Needle.rs main.rs");
        assert_eq!(highlighted(m), "Needle");
    }

    #[test]
    fn search_result_serializes_snake_case() {
        let turns = vec![turn(0, TurnRole::User, vec![tool_use("needle")])];
        let json = serde_json::to_value(search_turns(&turns, "needle", false, 100)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "matches": [{
                    "turn_index": 0,
                    "turn_id": "turn-0",
                    "role": "user",
                    "block": "tool_input",
                    "occurrence": 0,
                    "snippet": "needle",
                    "snippet_match_start": 0,
                    "snippet_match_end": 6,
                }],
                "total": 1,
                "truncated": false,
            })
        );
    }

    #[test]
    fn minimap_has_one_entry_per_user_message_with_its_last_reply() {
        let long_prompt = format!("{}   tail", "p".repeat(200));
        let long_reply = "r".repeat(300);
        let turns = vec![
            turn(
                0,
                TurnRole::User,
                vec![text("  "), text("first\n\n  question  ")],
            ),
            turn(1, TurnRole::Assistant, vec![text("early reply")]),
            turn(
                2,
                TurnRole::Assistant,
                vec![tool_use("ls"), text("final\nreply")],
            ),
            // A tool-result-only user turn does not start a new exchange.
            turn(3, TurnRole::User, vec![tool_result("out")]),
            turn(
                4,
                TurnRole::Assistant,
                vec![text("really final"), thinking("t")],
            ),
            turn(5, TurnRole::System, vec![text("system note")]),
            turn(6, TurnRole::User, vec![image()]),
            turn(7, TurnRole::Assistant, vec![text("about the image")]),
            turn(8, TurnRole::User, vec![text(&long_prompt)]),
            turn(9, TurnRole::Assistant, vec![text(&long_reply), text("   ")]),
            turn(10, TurnRole::User, vec![text("unanswered")]),
            turn(11, TurnRole::Assistant, vec![tool_use("ls")]),
        ];
        let entries = minimap_entries(&turns);
        let got: Vec<_> = entries
            .iter()
            .map(|e| {
                (
                    e.turn_index,
                    e.turn_id.as_str(),
                    e.prompt.clone(),
                    e.reply.clone(),
                )
            })
            .collect();
        assert_eq!(
            got,
            vec![
                (
                    0,
                    "turn-0",
                    "first question".to_string(),
                    Some("really final".to_string())
                ),
                (
                    8,
                    "turn-8",
                    format!("{}{ELLIPSIS}", "p".repeat(160)),
                    Some(format!("{}{ELLIPSIS}", "r".repeat(240)))
                ),
                (10, "turn-10", "unanswered".to_string(), None),
            ]
        );
        assert_eq!(entries[0].timestamp, ts());
    }

    #[test]
    fn minimap_clip_is_char_based_and_exact_length_is_not_cut() {
        assert_eq!(collapse_and_clip(&"汉".repeat(160), 160), "汉".repeat(160));
        assert_eq!(
            collapse_and_clip(&"汉".repeat(161), 160),
            format!("{}{ELLIPSIS}", "汉".repeat(160))
        );
        // A cut landing on a space drops it before the ellipsis.
        assert_eq!(collapse_and_clip("abc def", 4), format!("abc{ELLIPSIS}"));
        assert_eq!(collapse_and_clip("a\n\nb", 10), "a b");
    }

    #[test]
    fn minimap_serializes_snake_case() {
        let turns = vec![turn(0, TurnRole::User, vec![text("hi")])];
        let json = serde_json::to_value(minimap_entries(&turns)).unwrap();
        assert_eq!(
            json,
            serde_json::json!([{
                "turn_index": 0,
                "turn_id": "turn-0",
                "timestamp": "2026-11-22T10:00:00Z",
                "prompt": "hi",
                "reply": null,
            }])
        );
    }

    // ── End to end: the same turn list the history pages read ───────────────

    /// A conversation whose Claude transcript lives in a temp
    /// `CLAUDE_CONFIG_DIR` named by the agent's settings — hermetic, never
    /// reads the real `~/.claude`.
    #[tokio::test]
    async fn core_commands_index_the_full_turn_list() {
        use crate::commands::conversations::create_conversation_core;
        use crate::db::service::{agent_setting_service, conversation_service};
        use crate::db::test_helpers::{fresh_in_memory_db, seed_folder};
        use crate::models::AgentType;

        let config_dir = tempfile::tempdir().expect("tempdir");
        let project = config_dir.path().join("projects").join("-transcript-view");
        std::fs::create_dir_all(&project).expect("project dir");
        let session_id = "7c2d3e40-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
        std::fs::write(
            project.join(format!("{session_id}.jsonl")),
            [
                r#"{"type":"user","timestamp":"2026-11-22T01:00:00.000Z","uuid":"u1","cwd":"/tmp/codeg-transcript-view","message":{"role":"user","content":[{"type":"text","text":"Where is the Needle?"}]}}"#,
                r#"{"type":"assistant","timestamp":"2026-11-22T01:00:05.000Z","uuid":"a1","parentUuid":"u1","message":{"id":"msg_01","role":"assistant","model":"claude-opus-5","content":[{"type":"thinking","thinking":"look for the needle"},{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"grep -r needle"}}]}}"#,
                r#"{"type":"user","timestamp":"2026-11-22T01:00:06.000Z","uuid":"u2","parentUuid":"a1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"haystack/needle.txt"}]}}"#,
                r#"{"type":"assistant","timestamp":"2026-11-22T01:00:07.000Z","uuid":"a2","parentUuid":"u2","message":{"id":"msg_02","role":"assistant","model":"claude-opus-5","content":[{"type":"text","text":"Found it in haystack/needle.txt"}]}}"#,
                r#"{"type":"user","timestamp":"2026-11-22T01:01:00.000Z","uuid":"u3","parentUuid":"a2","message":{"role":"user","content":[{"type":"text","text":"谢谢"}]}}"#,
            ]
            .join("\n"),
        )
        .expect("write transcript");

        let db = fresh_in_memory_db().await;
        agent_setting_service::ensure_defaults(
            &db.conn,
            &[agent_setting_service::AgentDefaultInput {
                agent_type: AgentType::ClaudeCode,
                registry_id: AgentType::ClaudeCode.to_string(),
                default_sort_order: 0,
            }],
        )
        .await
        .expect("seed agent setting");
        agent_setting_service::update(
            &db.conn,
            AgentType::ClaudeCode,
            agent_setting_service::AgentSettingsUpdate {
                enabled: true,
                env_json: Some(
                    serde_json::json!({ "CLAUDE_CONFIG_DIR": config_dir.path() }).to_string(),
                ),
                model_provider_id: None,
            },
        )
        .await
        .expect("save env_json");
        let folder_id = seed_folder(&db, "/tmp/codeg-transcript-view").await;
        let conv_id = create_conversation_core(&db.conn, folder_id, AgentType::ClaudeCode, None)
            .await
            .expect("create conversation");
        conversation_service::bind_external_id(&db.conn, conv_id, session_id, &[])
            .await
            .expect("bind session");

        // The full list the history pages and the outline slice.
        let (detail, _) = get_folder_conversation_core(&db.conn, conv_id)
            .await
            .expect("open conversation");
        let full = detail.turns;
        assert_eq!(full.len(), 4, "turns: {full:?}");

        let r = search_conversation_core(&db.conn, conv_id, "needle".into(), false, None)
            .await
            .expect("search");
        assert!(r.total >= 4, "matches: {:?}", r.matches);
        for m in &r.matches {
            assert_eq!(full[m.turn_index].id, m.turn_id);
        }
        let blocks: std::collections::HashSet<_> = r.matches.iter().map(|m| m.block).collect();
        for kind in [
            SearchBlockKind::Text,
            SearchBlockKind::Thinking,
            SearchBlockKind::ToolInput,
            SearchBlockKind::ToolOutput,
        ] {
            assert!(blocks.contains(&kind), "{kind:?} missing: {:?}", r.matches);
        }
        let cased = search_conversation_core(&db.conn, conv_id, "Needle".into(), true, None)
            .await
            .expect("search");
        assert_eq!(cased.total, 1);
        let blank = search_conversation_core(&db.conn, conv_id, "  ".into(), false, None)
            .await
            .expect("search");
        assert_eq!(blank.total, 0);

        let minimap = get_conversation_minimap_core(&db.conn, conv_id)
            .await
            .expect("minimap");
        assert_eq!(minimap.len(), 2, "{minimap:?}");
        assert_eq!(minimap[0].prompt, "Where is the Needle?");
        assert_eq!(
            minimap[0].reply.as_deref(),
            Some("Found it in haystack/needle.txt")
        );
        assert_eq!(minimap[1].prompt, "谢谢");
        assert_eq!(minimap[1].reply, None);
        for e in &minimap {
            assert_eq!(full[e.turn_index].id, e.turn_id);
            assert!(matches!(full[e.turn_index].role, TurnRole::User));
        }
    }
}
