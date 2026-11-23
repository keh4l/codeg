//! Parsed conversation details, kept while their transcript is unchanged
//! (fork).
//!
//! Opening a conversation asks the server for its detail window, its minimap
//! and its navigator outline at once, and scrolling up asks for page after
//! page — and each of those parses the agent's whole transcript again. A
//! long Claude Code session takes the better part of a second to parse on a
//! slow core, so on a remote client the same parse ran three times in a row
//! at every open and once more per page.
//!
//! This keeps the last few parses, keyed by transcript, each with a
//! fingerprint of the files it was read from taken BEFORE the parse: a later
//! request whose fingerprint still matches gets a copy, one that arrives
//! while the same parse is running waits for it, anything else parses. A
//! file appended to while it was being parsed therefore never matches the
//! fingerprint the entry was stored under, and is parsed again next time.
//!
//! Only Claude Code sessions are cached: everything its parser reads for a
//! session id lives under the project directory that holds `<id>.jsonl` (the
//! `/clear` successors beside it, `<id>/subagents/…` under it), so the
//! fingerprint is the size and modification time of every file there. Other
//! agents parse every time, as before.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use crate::models::agent::AgentType;
use crate::models::conversation::ConversationDetail;
use crate::parsers::{AgentEnv, AgentParser, ParseError};

/// Details kept, least recently used dropped first.
const DEFAULT_MAX_ENTRIES: usize = 6;

struct Entry {
    fingerprint: u64,
    detail: Arc<ConversationDetail>,
    used: u64,
}

/// A parse under way that requests with the same fingerprint wait for.
struct Flight {
    fingerprint: u64,
    /// `Some(None)`: the parse failed; a waiter then parses itself.
    done: Mutex<Option<Option<Arc<ConversationDetail>>>>,
    ready: Condvar,
}

#[derive(Default)]
struct Cache {
    entries: HashMap<String, Entry>,
    flights: HashMap<String, Arc<Flight>>,
    clock: u64,
    parses: u64,
}

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Cache::default()))
}

fn max_entries() -> usize {
    static MAX: OnceLock<usize> = OnceLock::new();
    *MAX.get_or_init(|| {
        std::env::var("CODEG_DETAIL_CACHE_ENTRIES")
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(DEFAULT_MAX_ENTRIES)
    })
}

/// `parser.get_conversation(id)`, from the cache when the transcript is
/// unchanged. Blocking (file system work); call it where the parse ran.
pub fn get_conversation(
    agent_type: AgentType,
    env: &AgentEnv,
    parser: &dyn AgentParser,
    id: &str,
) -> Result<ConversationDetail, ParseError> {
    let base = match agent_type {
        AgentType::ClaudeCode => Some(crate::parsers::claude::resolve_claude_projects_dir_for_env(
            env,
        )),
        _ => None,
    };
    get_conversation_in(base.as_deref(), parser, id)
}

fn get_conversation_in(
    claude_base: Option<&Path>,
    parser: &dyn AgentParser,
    id: &str,
) -> Result<ConversationDetail, ParseError> {
    let max = max_entries();
    let keyed = claude_base
        .filter(|_| max > 0)
        .and_then(|base| claude_fingerprint(base, id).map(|fp| (base, fp)));
    let Some((base, fingerprint)) = keyed else {
        return parser.get_conversation(id);
    };
    let key = format!("{}\0{id}", base.display());

    let flight = {
        let mut cache = cache().lock().unwrap_or_else(|e| e.into_inner());
        cache.clock += 1;
        let now = cache.clock;
        if let Some(entry) = cache.entries.get_mut(&key) {
            if entry.fingerprint == fingerprint {
                entry.used = now;
                return Ok((*entry.detail).clone());
            }
        }
        match cache.flights.get(&key) {
            Some(flight) if flight.fingerprint == fingerprint => {
                let flight = Arc::clone(flight);
                drop(cache);
                if let Some(detail) = wait(&flight) {
                    return Ok((*detail).clone());
                }
                // The parse it waited for failed: try for itself.
                return parser.get_conversation(id);
            }
            _ => {}
        }
        let flight = Arc::new(Flight {
            fingerprint,
            done: Mutex::new(None),
            ready: Condvar::new(),
        });
        cache.flights.insert(key.clone(), Arc::clone(&flight));
        cache.parses += 1;
        flight
    };

    let result = parser.get_conversation(id);
    let shared = result.as_ref().ok().map(|d| Arc::new(d.clone()));
    {
        let mut cache = cache().lock().unwrap_or_else(|e| e.into_inner());
        if cache
            .flights
            .get(&key)
            .is_some_and(|f| Arc::ptr_eq(f, &flight))
        {
            cache.flights.remove(&key);
        }
        if let Some(detail) = &shared {
            cache.clock += 1;
            let used = cache.clock;
            cache.entries.insert(
                key,
                Entry {
                    fingerprint,
                    detail: Arc::clone(detail),
                    used,
                },
            );
            while cache.entries.len() > max {
                let Some(oldest) = cache
                    .entries
                    .iter()
                    .min_by_key(|(_, e)| e.used)
                    .map(|(k, _)| k.clone())
                else {
                    break;
                };
                cache.entries.remove(&oldest);
            }
        }
    }
    *flight.done.lock().unwrap_or_else(|e| e.into_inner()) = Some(shared);
    flight.ready.notify_all();
    result
}

fn wait(flight: &Flight) -> Option<Arc<ConversationDetail>> {
    let mut done = flight.done.lock().unwrap_or_else(|e| e.into_inner());
    loop {
        if let Some(result) = done.as_ref() {
            return result.clone();
        }
        done = flight.ready.wait(done).unwrap_or_else(|e| e.into_inner());
    }
}

/// Fingerprint of everything Claude's parser reads for session `id`: the
/// size and modification time of every file and directory under the project
/// directory holding `<id>.jsonl`. `None` for an id that is not a session
/// (a sub-agent opened by its `agentId`) or a session not found.
fn claude_fingerprint(base: &Path, id: &str) -> Option<u64> {
    uuid::Uuid::parse_str(id).ok()?;
    let file = format!("{id}.jsonl");
    let project = std::fs::read_dir(base)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|dir| dir.join(&file).is_file())?;
    Some(tree_fingerprint(&project))
}

fn tree_fingerprint(root: &Path) -> u64 {
    let mut seen: Vec<(PathBuf, u64, u128)> = walkdir::WalkDir::new(root)
        .max_depth(6)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos());
            Some((entry.into_path(), meta.len(), modified))
        })
        .collect();
    seen.sort_unstable();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    seen.hash(&mut hasher);
    hasher.finish()
}

/// Test hook: how many parses the cache has started.
#[cfg(test)]
fn parses() -> u64 {
    cache().lock().unwrap().parses
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    /// Counts its parses; each takes a moment, so concurrent ones overlap.
    struct Counting {
        inner: Box<dyn AgentParser + Send + Sync>,
        calls: AtomicUsize,
    }

    impl AgentParser for Counting {
        fn list_conversations(
            &self,
        ) -> Result<Vec<crate::models::conversation::ConversationSummary>, ParseError> {
            self.inner.list_conversations()
        }
        fn get_conversation(&self, id: &str) -> Result<ConversationDetail, ParseError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(50));
            self.inner.get_conversation(id)
        }
    }

    fn line(kind: &str, uuid: &str, text: &str) -> String {
        serde_json::json!({
            "type": kind, "uuid": uuid, "timestamp": "2026-11-23T10:00:00.000Z", "cwd": "/w",
            "message": { "role": kind, "content": [{ "type": "text", "text": text }] },
        })
        .to_string()
            + "\n"
    }

    #[test]
    fn a_transcript_is_parsed_once_until_it_changes() {
        let base = tempfile::tempdir().unwrap();
        let project = base.path().join("-w");
        std::fs::create_dir_all(&project).unwrap();
        let id = "5d1f0c2e-6b7a-4c8d-9e0f-a1b2c3d4e5f6";
        let path = project.join(format!("{id}.jsonl"));
        std::fs::write(&path, line("user", "u1", "hello")).unwrap();
        let parser = Arc::new(Counting {
            inner: Box::new(crate::parsers::claude::ClaudeParser::with_base_dir(
                base.path().to_path_buf(),
            )),
            calls: AtomicUsize::new(0),
        });

        // Three requests at once (detail, minimap, outline): one parse.
        let threads: Vec<_> = (0..3)
            .map(|_| {
                let parser = Arc::clone(&parser);
                let base = base.path().to_path_buf();
                std::thread::spawn(move || {
                    get_conversation_in(Some(&base), &*parser, id).map(|d| d.turns.len())
                })
            })
            .collect();
        for thread in threads {
            assert_eq!(thread.join().unwrap().unwrap(), 1);
        }
        assert_eq!(parser.calls.load(Ordering::SeqCst), 1);

        // Unchanged: from the cache.
        let again = get_conversation_in(Some(base.path()), &*parser, id).unwrap();
        assert_eq!(again.turns.len(), 1);
        assert_eq!(parser.calls.load(Ordering::SeqCst), 1);

        // Appended to: parsed again, with the new turn.
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        std::io::Write::write_all(&mut file, line("assistant", "a1", "hi").as_bytes()).unwrap();
        drop(file);
        let changed = get_conversation_in(Some(base.path()), &*parser, id).unwrap();
        assert_eq!(changed.turns.len(), 2);
        assert_eq!(parser.calls.load(Ordering::SeqCst), 2);

        // A file added under the project (a sub-agent's transcript) too.
        std::fs::create_dir_all(project.join(id).join("subagents")).unwrap();
        get_conversation_in(Some(base.path()), &*parser, id).unwrap();
        assert_eq!(parser.calls.load(Ordering::SeqCst), 3);
        assert!(parses() >= 3);
    }

    #[test]
    fn other_agents_and_non_session_ids_always_parse() {
        let base = tempfile::tempdir().unwrap();
        let parser = Counting {
            inner: Box::new(crate::parsers::claude::ClaudeParser::with_base_dir(
                base.path().to_path_buf(),
            )),
            calls: AtomicUsize::new(0),
        };
        for _ in 0..2 {
            let _ = get_conversation_in(None, &parser, "5d1f0c2e-6b7a-4c8d-9e0f-a1b2c3d4e5f6");
            let _ = get_conversation_in(Some(base.path()), &parser, "agent-a18d64a8");
        }
        assert_eq!(parser.calls.load(Ordering::SeqCst), 4);
    }
}
