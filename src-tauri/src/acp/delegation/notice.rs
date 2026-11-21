//! keh4l build: the frame that hands finished delegations back to the parent
//! agent, and what a transcript shows in its place.
//!
//! A batch of results reaches the parent as one Codeg-authored prompt block
//! (see `super::delivery`): a whole prompt when Codeg wakes an idle parent,
//! an injection into the turn it is running, or a suffix after the user's next
//! message. The block uses the envelope of the other internal frames
//! (`crate::acp::agent_mentions`): the reserved separator around exactly three
//! newline-terminated lines that open with a `{"kind":…}` descriptor, and the
//! identity rule that a candidate counts only if the current renderer
//! reproduces it byte for byte. The separator is scrubbed from every prompt at
//! ingress, so a user cannot forge one.
//!
//! It is deliberately NOT one of `agent_mentions`' frame kinds. Those are
//! transport metadata a reader removes; this one is the content of a turn,
//! which the reader turns into a [`ContentBlock::DelegationResults`] instead
//! ([`lift_results_from_turns`], run by `parsers::RouteSanitized` before its
//! own strip). Registered there, the Codex parser would drop a wake prompt as
//! "routing only" before anything could show it.

use serde::{Deserialize, Serialize};

use crate::models::delegation_results::{
    DelegationResultsMode, DelegationResultsTask, DelegationWorktreeInfo,
};
use crate::models::message::{ContentBlock, MessageTurn, TurnRole};

const SEPARATOR: char = '\u{001e}';
pub(crate) const KIND: &str = "codeg_internal_delegation_results";
const VERSION: u8 = 1;
/// Opening bytes of every rendered body — the anchor for a transcript that
/// lost the separators (Antigravity rewrites them to spaces).
const BODY_PREFIX: &str = "{\"kind\":\"codeg_internal_delegation_results\"";
const PAYLOAD_LINE_PREFIX: &str = "Codeg delegation results (authoritative): ";
/// Whole frame, separators included.
pub(crate) const MAX_FRAME_BYTES: usize = 32 * 1024;
/// Characters of one task's result text a frame carries at most.
pub(crate) const TASK_TEXT_CAP: usize = 8000;
/// Characters of result text the UI block keeps per task.
const PREVIEW_CAP: usize = 400;
/// Below this many characters a result is dropped rather than cut further.
const MIN_KEPT_TEXT: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Descriptor {
    kind: String,
    version: u8,
    nonce: String,
}

/// One finished task, as the parent agent reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoticeTask {
    pub task_id: String,
    pub agent_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assistant: Option<String>,
    /// `completed` / `failed` / `canceled`.
    pub status: String,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// The text was cut to fit; `get_delegation_status` returns it whole.
    #[serde(default, skip_serializing_if = "is_false")]
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// It broke off before finishing, and `resume_delegation` can continue it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub resumable: bool,
    pub child_conversation_id: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<DelegationWorktreeInfo>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoticePayload {
    pub mode: DelegationResultsMode,
    pub tasks: Vec<NoticeTask>,
    /// Task ids of this parent's delegations still running when it was sent.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub still_running: Vec<String>,
}

/// A frame ready to send, with what the UI shows for it.
#[derive(Debug, Clone)]
pub struct RenderedNotice {
    /// The frame's nonce, which the live event and the transcript block share.
    pub id: String,
    /// The whole frame, separators included.
    pub text: String,
    pub mode: DelegationResultsMode,
    pub tasks: Vec<DelegationResultsTask>,
}

/// The third line, fixed per mode: changing a word orphans every frame
/// already in a transcript, so any edit must bump [`VERSION`].
fn instruction(mode: DelegationResultsMode) -> &'static str {
    match mode {
        DelegationResultsMode::Wake => {
            "Delegated tasks of yours finished and their results are above. Continue the work \
             they belong to; if nothing is left to do, tell the user the outcome and end your \
             turn. Tasks still running are handed to you the same way when they finish, so do \
             not poll get_delegation_status for them. A task marked resumable broke off before \
             finishing: resume_delegation continues it."
        }
        DelegationResultsMode::Steer => {
            "Delegated tasks of yours finished while you were working and their results are \
             above. Use them in what you are doing now. Tasks still running are handed to you \
             the same way when they finish, so do not poll get_delegation_status for them. A \
             task marked resumable broke off before finishing: resume_delegation continues it."
        }
        DelegationResultsMode::Attached => {
            "Delegated tasks of yours finished since your last turn and their results are \
             above. They are context for the user's message before this note, which is what to \
             act on. Tasks still running are handed to you the same way when they finish. A \
             task marked resumable broke off before finishing: resume_delegation continues it."
        }
    }
}

fn render_body(descriptor: &Descriptor, payload: &NoticePayload) -> String {
    let descriptor = serde_json::to_string(descriptor).expect("descriptor is serializable");
    let payload_json = serde_json::to_string(payload).expect("payload is serializable");
    format!(
        "{descriptor}\n{PAYLOAD_LINE_PREFIX}{payload_json}\n{}\n",
        instruction(payload.mode)
    )
}

fn frame_len(body: &str) -> usize {
    body.len() + 2 * SEPARATOR.len_utf8()
}

fn cut_chars(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => text[..end].to_string(),
        None => text.to_string(),
    }
}

/// Render a batch, cutting result texts until the frame fits
/// [`MAX_FRAME_BYTES`]: the longest text is halved first, and one already
/// short is dropped (the status stays). `None` for an empty batch.
pub fn render(
    mode: DelegationResultsMode,
    mut tasks: Vec<NoticeTask>,
    still_running: Vec<String>,
) -> Option<RenderedNotice> {
    if tasks.is_empty() {
        return None;
    }
    for task in &mut tasks {
        if let Some(text) = &task.text {
            if text.chars().count() > TASK_TEXT_CAP {
                task.text = Some(cut_chars(text, TASK_TEXT_CAP));
                task.truncated = true;
            }
        }
    }
    let descriptor = Descriptor {
        kind: KIND.to_string(),
        version: VERSION,
        nonce: uuid::Uuid::new_v4().to_string(),
    };
    let mut payload = NoticePayload {
        mode,
        tasks,
        still_running,
    };
    let mut body = render_body(&descriptor, &payload);
    while frame_len(&body) > MAX_FRAME_BYTES {
        let longest = payload
            .tasks
            .iter_mut()
            .filter(|t| t.text.is_some())
            .max_by_key(|t| t.text.as_ref().map_or(0, String::len));
        if let Some(task) = longest {
            let text = task.text.take().unwrap_or_default();
            let chars = text.chars().count();
            if chars > MIN_KEPT_TEXT {
                task.text = Some(cut_chars(&text, chars / 2));
            }
            task.truncated = true;
        } else if let Some(task) = payload
            .tasks
            .iter_mut()
            .filter(|t| t.message.is_some())
            .max_by_key(|t| t.message.as_ref().map_or(0, String::len))
        {
            let message = task.message.take().unwrap_or_default();
            if message.chars().count() > MIN_KEPT_TEXT {
                task.message = Some(cut_chars(&message, MIN_KEPT_TEXT));
            }
        } else if payload.still_running.len() > 1 {
            payload
                .still_running
                .truncate(payload.still_running.len() / 2);
        } else {
            // Ids and statuses alone over 32 KB: hundreds of tasks finishing
            // in one window. Send it anyway; the window the readers scan in
            // is far larger.
            break;
        }
        body = render_body(&descriptor, &payload);
    }
    Some(RenderedNotice {
        id: descriptor.nonce,
        text: format!("{SEPARATOR}{body}{SEPARATOR}"),
        mode,
        tasks: payload.tasks.iter().map(summarize).collect(),
    })
}

/// What the UI keeps of one task: a bounded preview of its result (or of
/// why it failed).
pub fn summarize(task: &NoticeTask) -> DelegationResultsTask {
    let preview = task
        .text
        .as_deref()
        .or(task.message.as_deref())
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| {
            let cut = cut_chars(t, PREVIEW_CAP);
            if cut.len() < t.len() {
                format!("{cut}…")
            } else {
                cut
            }
        });
    DelegationResultsTask {
        task_id: task.task_id.clone(),
        agent_type: task.agent_type.clone(),
        assistant: task.assistant.clone(),
        status: task.status.clone(),
        duration_ms: task.duration_ms,
        preview,
        error_code: task.error_code.clone(),
        child_conversation_id: task.child_conversation_id,
        resumable: task.resumable,
        worktree: task.worktree.clone(),
    }
}

/// Parse a body (separators removed) the current renderer reproduces
/// exactly; anything else is not a frame.
fn parse_body(candidate: &str) -> Option<(String, NoticePayload)> {
    if frame_len(candidate) > MAX_FRAME_BYTES * 2 {
        return None;
    }
    let (descriptor_line, rest) = candidate.split_once('\n')?;
    let descriptor: Descriptor = serde_json::from_str(descriptor_line).ok()?;
    if descriptor.kind != KIND
        || descriptor.version != VERSION
        || uuid::Uuid::parse_str(&descriptor.nonce).is_err()
    {
        return None;
    }
    let payload_json = rest.lines().next()?.strip_prefix(PAYLOAD_LINE_PREFIX)?;
    let payload: NoticePayload = serde_json::from_str(payload_json).ok()?;
    if render_body(&descriptor, &payload) != candidate {
        return None;
    }
    Some((descriptor.nonce, payload))
}

/// A frame found in some text: its byte span and what it carried.
struct Found {
    start: usize,
    end: usize,
    id: String,
    payload: NoticePayload,
}

/// The window a closing separator is looked for in.
const SCAN_WINDOW: usize = MAX_FRAME_BYTES * 2;

fn find_separated(input: &str, from: usize) -> Option<Found> {
    let mut search_from = from;
    while search_from < input.len() {
        let start = search_from + input[search_from..].find(SEPARATOR)?;
        let after = start + SEPARATOR.len_utf8();
        let mut bound = (after + SCAN_WINDOW).min(input.len());
        while !input.is_char_boundary(bound) {
            bound -= 1;
        }
        if input[after..bound].starts_with(BODY_PREFIX) {
            if let Some(close) = input[after..bound].find(SEPARATOR) {
                if let Some((id, payload)) = parse_body(&input[after..after + close]) {
                    return Some(Found {
                        start,
                        end: after + close + SEPARATOR.len_utf8(),
                        id,
                        payload,
                    });
                }
            }
        }
        search_from = after;
    }
    None
}

fn find_unseparated(input: &str, from: usize) -> Option<Found> {
    let mut search_from = from;
    while search_from < input.len() {
        let start = search_from + input[search_from..].find(BODY_PREFIX)?;
        let mut cursor = start;
        let mut lines = 0;
        while lines < 3 {
            match input[cursor..].find('\n') {
                Some(nl) if cursor + nl - start <= SCAN_WINDOW => {
                    cursor += nl + 1;
                    lines += 1;
                }
                _ => break,
            }
        }
        if lines == 3 {
            if let Some((id, payload)) = parse_body(&input[start..cursor]) {
                return Some(Found {
                    start,
                    end: cursor,
                    id,
                    payload,
                });
            }
        } else if lines == 2 && input.len() - start <= SCAN_WINDOW {
            // Claude Code stores the prompt with the separators dropped AND
            // the text trimmed, so a frame at the end of it has lost its last
            // newline as well. Still the whole body, byte for byte, short of
            // that one newline.
            let candidate = format!("{}\n", &input[start..]);
            if let Some((id, payload)) = parse_body(&candidate) {
                return Some(Found {
                    start,
                    end: input.len(),
                    id,
                    payload,
                });
            }
        }
        search_from = start + BODY_PREFIX.len();
    }
    None
}

fn find_frame(input: &str, from: usize) -> Option<Found> {
    match (find_separated(input, from), find_unseparated(input, from)) {
        (Some(separated), Some(bare)) if bare.start < separated.start => Some(bare),
        (Some(separated), _) => Some(separated),
        (None, bare) => bare,
    }
}

/// Whether `text` holds a results frame — one `memchr`-class scan for text
/// without the body anchor.
pub fn contains_frame(text: &str) -> bool {
    text.contains(BODY_PREFIX) && find_frame(text, 0).is_some()
}

/// Remove every results frame from `text`, returning what is left (trimmed at
/// the end, a newline beside a frame absorbed) and the frames, in order.
pub fn extract(text: &str) -> (String, Vec<(String, NoticePayload)>) {
    if !text.contains(BODY_PREFIX) {
        return (text.to_string(), Vec::new());
    }
    let mut out = String::with_capacity(text.len());
    let mut frames = Vec::new();
    let mut cursor = 0;
    while let Some(found) = find_frame(text, cursor) {
        let mut keep_end = found.start;
        if keep_end > cursor && text.as_bytes()[keep_end - 1] == b'\n' {
            keep_end -= 1;
        }
        out.push_str(&text[cursor..keep_end]);
        cursor = found.end;
        if keep_end == found.start && text.as_bytes().get(cursor) == Some(&b'\n') {
            cursor += 1;
        }
        frames.push((found.id, found.payload));
    }
    out.push_str(&text[cursor..]);
    if !frames.is_empty() {
        out.truncate(out.trim_end().len());
    }
    (out, frames)
}

fn results_block(id: String, payload: &NoticePayload) -> ContentBlock {
    ContentBlock::DelegationResults {
        id,
        mode: payload.mode,
        tasks: payload.tasks.iter().map(summarize).collect(),
    }
}

/// Turn the results frames in a transcript's user turns into
/// [`ContentBlock::DelegationResults`]: a turn that was nothing but frames
/// becomes a `System` turn holding their blocks; a user message that carried
/// one keeps its text and gets the blocks appended.
pub fn lift_results_from_turns(turns: &mut [MessageTurn]) {
    for turn in turns.iter_mut() {
        if !matches!(turn.role, TurnRole::User) {
            continue;
        }
        let mut lifted: Vec<ContentBlock> = Vec::new();
        turn.blocks.retain_mut(|block| {
            let ContentBlock::Text { text } = block else {
                return true;
            };
            if !text.contains(BODY_PREFIX) {
                return true;
            }
            let (rest, frames) = extract(text);
            if frames.is_empty() {
                return true;
            }
            lifted.extend(frames.iter().map(|(id, p)| results_block(id.clone(), p)));
            *text = rest;
            !text.trim().is_empty()
        });
        if lifted.is_empty() {
            continue;
        }
        let nothing_else = turn.blocks.iter().all(|block| match block {
            ContentBlock::Text { text } => text.trim().is_empty(),
            _ => false,
        });
        if nothing_else {
            turn.role = TurnRole::System;
            turn.blocks = lifted;
        } else {
            turn.blocks.extend(lifted);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str, text: &str) -> NoticeTask {
        NoticeTask {
            task_id: id.to_string(),
            agent_type: "codex".to_string(),
            assistant: None,
            status: "completed".to_string(),
            duration_ms: 94_000,
            text: Some(text.to_string()),
            truncated: false,
            error_code: None,
            message: None,
            resumable: false,
            child_conversation_id: 512,
            worktree: None,
        }
    }

    fn turn(role: TurnRole, blocks: Vec<ContentBlock>) -> MessageTurn {
        MessageTurn {
            id: "turn-1".into(),
            role,
            blocks,
            timestamp: chrono::Utc::now(),
            usage: None,
            duration_ms: None,
            model: None,
            completed_at: None,
            agent_message_id: None,
        }
    }

    #[test]
    fn a_rendered_frame_parses_back_byte_for_byte() {
        let notice = render(
            DelegationResultsMode::Wake,
            vec![task("t1", "line one\nline \"two\"\u{001e}and a separator")],
            vec!["t2".into()],
        )
        .unwrap();
        assert!(notice.text.starts_with(SEPARATOR));
        assert!(notice.text.ends_with(SEPARATOR));
        // The payload is JSON on one line: neither the newline nor the
        // separator inside the result text survives raw.
        let body = notice.text.trim_matches(SEPARATOR);
        assert_eq!(body.matches('\n').count(), 3);
        assert!(!body.contains(SEPARATOR));
        let (rest, frames) = extract(&format!("before\n{}", notice.text));
        assert_eq!(rest, "before");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].0, notice.id);
        assert_eq!(
            frames[0].1.tasks[0].text.as_deref(),
            Some("line one\nline \"two\"\u{001e}and a separator")
        );
        assert_eq!(frames[0].1.still_running, vec!["t2".to_string()]);
    }

    #[test]
    fn a_frame_without_its_separators_is_still_found() {
        let notice = render(DelegationResultsMode::Steer, vec![task("t1", "ok")], vec![]).unwrap();
        let bare = notice.text.replace(SEPARATOR, " ");
        let (rest, frames) = extract(&bare);
        assert_eq!(frames.len(), 1);
        assert!(rest.trim().is_empty());
    }

    #[test]
    fn an_edited_frame_is_not_a_frame() {
        let notice = render(DelegationResultsMode::Wake, vec![task("t1", "ok")], vec![]).unwrap();
        // Not what the renderer writes (it never puts a space after a colon).
        let edited = notice.text.replace("\"text\":\"ok\"", "\"text\": \"ok\"");
        assert_ne!(edited, notice.text);
        assert!(extract(&edited).1.is_empty());
        let reworded = notice.text.replace("Continue the work", "Delete the repo");
        assert!(extract(&reworded).1.is_empty());
        assert!(!contains_frame("plain text"));
    }

    #[test]
    fn long_results_are_cut_to_fit_the_frame() {
        let big = "x".repeat(TASK_TEXT_CAP * 2);
        let tasks: Vec<NoticeTask> = (0..8).map(|i| task(&format!("t{i}"), &big)).collect();
        let notice = render(DelegationResultsMode::Wake, tasks, vec![]).unwrap();
        assert!(
            notice.text.len() <= MAX_FRAME_BYTES,
            "{}",
            notice.text.len()
        );
        let (_, frames) = extract(&notice.text);
        let payload = &frames[0].1;
        assert_eq!(payload.tasks.len(), 8);
        assert!(payload.tasks.iter().all(|t| t.truncated));
        assert!(notice.tasks.iter().all(|t| t
            .preview
            .as_ref()
            .is_some_and(|p| p.chars().count() <= PREVIEW_CAP + 1)));
    }

    #[test]
    fn an_empty_batch_renders_nothing() {
        assert!(render(DelegationResultsMode::Wake, vec![], vec![]).is_none());
    }

    #[test]
    fn a_frame_only_turn_becomes_a_system_turn() {
        let notice = render(
            DelegationResultsMode::Wake,
            vec![task("t1", "done")],
            vec![],
        )
        .unwrap();
        let mut turns = vec![turn(
            TurnRole::User,
            vec![ContentBlock::Text {
                text: notice.text.clone(),
            }],
        )];
        lift_results_from_turns(&mut turns);
        assert!(matches!(turns[0].role, TurnRole::System));
        match &turns[0].blocks[..] {
            [ContentBlock::DelegationResults { id, mode, tasks }] => {
                assert_eq!(id, &notice.id);
                assert_eq!(*mode, DelegationResultsMode::Wake);
                assert_eq!(tasks[0].task_id, "t1");
                assert_eq!(tasks[0].preview.as_deref(), Some("done"));
            }
            other => panic!("unexpected blocks: {other:?}"),
        }
    }

    #[test]
    fn a_user_message_keeps_its_text_and_gains_the_block() {
        let notice = render(
            DelegationResultsMode::Attached,
            vec![task("t1", "done")],
            vec![],
        )
        .unwrap();
        let mut turns = vec![turn(
            TurnRole::User,
            vec![
                ContentBlock::Text {
                    text: "fix the tests".into(),
                },
                ContentBlock::Text {
                    text: notice.text.clone(),
                },
            ],
        )];
        lift_results_from_turns(&mut turns);
        assert!(matches!(turns[0].role, TurnRole::User));
        assert!(
            matches!(&turns[0].blocks[0], ContentBlock::Text { text } if text == "fix the tests")
        );
        assert!(matches!(
            &turns[0].blocks[1],
            ContentBlock::DelegationResults {
                mode: DelegationResultsMode::Attached,
                ..
            }
        ));
        assert_eq!(turns[0].blocks.len(), 2);

        // Joined into one text block, as some agents store a prompt.
        let mut joined = vec![turn(
            TurnRole::User,
            vec![ContentBlock::Text {
                text: format!("fix the tests\n\n{}", notice.text),
            }],
        )];
        lift_results_from_turns(&mut joined);
        assert!(
            matches!(&joined[0].blocks[0], ContentBlock::Text { text } if text == "fix the tests")
        );
        assert_eq!(joined[0].blocks.len(), 2);
    }

    #[test]
    fn assistant_turns_are_left_alone() {
        let notice = render(
            DelegationResultsMode::Wake,
            vec![task("t1", "done")],
            vec![],
        )
        .unwrap();
        let mut turns = vec![turn(
            TurnRole::Assistant,
            vec![ContentBlock::Text {
                text: notice.text.clone(),
            }],
        )];
        lift_results_from_turns(&mut turns);
        assert!(matches!(turns[0].role, TurnRole::Assistant));
        assert!(matches!(&turns[0].blocks[0], ContentBlock::Text { .. }));
    }

    #[test]
    fn a_frame_stored_trimmed_and_without_separators_is_still_one() {
        // What Claude Code writes to its transcript for a wake prompt: the
        // separators gone and the trailing newline trimmed off.
        let notice = render(
            DelegationResultsMode::Wake,
            vec![task("t-1", "done")],
            vec![],
        )
        .unwrap();
        let stored = notice.text.trim_matches(SEPARATOR).trim_end().to_string();
        assert!(contains_frame(&stored));
        let (rest, frames) = extract(&stored);
        assert_eq!(rest, "");
        assert_eq!(frames.len(), 1);
        // And riding after a user message (attached).
        let attached = render(
            DelegationResultsMode::Attached,
            vec![task("t-1", "done")],
            vec![],
        )
        .unwrap();
        let stored = format!(
            "please go on\n{}",
            attached.text.trim_matches(SEPARATOR).trim_end()
        );
        let (rest, frames) = extract(&stored);
        assert_eq!(rest, "please go on");
        assert_eq!(frames.len(), 1);
        // A body cut anywhere else is not a frame.
        let cut = &notice.text.trim_matches(SEPARATOR)[..notice.text.len() / 2];
        assert!(!contains_frame(cut));
    }
}
