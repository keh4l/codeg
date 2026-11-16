//! `create_assistant` / `update_assistant` as the delegation listener hands
//! them over: the arguments as the agent sent them, the caller's working
//! directory (where the agent is probed), and back a self-describing outcome
//! `{ "text", "is_error", "assistant_id"? }` the companion renders as is.
//!
//! The reply is written for the model: what was saved, which picks it asked
//! for, which were left at the agent's defaults, and how to mention the
//! assistant. Its `assistant_id=N` is also how the conversation card finds the
//! assistant to draw (`src/lib/assistant-tools.ts`); keep the two in step.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde_json::{json, Value};

use super::selection::{self, Pick, PickSource, Requested, Resolved};
use crate::acp::types::{AgentOptionsSnapshot, SessionConfigKindInfo};
use crate::db::service::{agent_setting_service, assistant_service};
use crate::db::AppDatabase;
use crate::models::agent::BUILTIN_AGENT_TYPES;
use crate::models::assistant::ASSISTANT_AVATAR_COLORS;
use crate::models::{AgentType, AssistantAvatar, AssistantDraft, AssistantInfo, AssistantPatch};
use crate::web::event_bridge::EventEmitter;

/// Who is calling.
#[derive(Debug, Clone)]
pub struct Caller {
    /// The calling agent's working directory: the agent being set up is
    /// probed there, as the editor probes it in the open project.
    pub working_dir: PathBuf,
}

/// What a call needs from the parent process. A trait so the tool logic is
/// tested against an in-memory database and a scripted probe.
#[async_trait]
pub trait Deps: Send + Sync {
    fn enabled(&self) -> bool;
    fn db(&self) -> &AppDatabase;
    fn emitter(&self) -> &EventEmitter;
    /// What `agent_type` advertises, with `values` applied first — the
    /// editor's probe (`acp_describe_agent_options`).
    async fn probe(
        &self,
        agent_type: AgentType,
        working_dir: &Path,
        values: BTreeMap<String, String>,
    ) -> Result<AgentOptionsSnapshot, String>;
}

struct LiveDeps(&'static super::Runtime);

#[async_trait]
impl Deps for LiveDeps {
    fn enabled(&self) -> bool {
        super::is_enabled()
    }

    fn db(&self) -> &AppDatabase {
        &self.0.db
    }

    fn emitter(&self) -> &EventEmitter {
        &self.0.emitter
    }

    async fn probe(
        &self,
        agent_type: AgentType,
        working_dir: &Path,
        values: BTreeMap<String, String>,
    ) -> Result<AgentOptionsSnapshot, String> {
        crate::commands::acp::acp_describe_agent_options_core(
            &self.0.manager,
            &self.0.db,
            &self.0.data_dir,
            agent_type,
            Some(working_dir.to_string_lossy().to_string()),
            values,
        )
        .await
        .map_err(|e| e.to_string())
    }
}

/// Serve one call in this process.
pub async fn handle(tool: &str, input: Value, caller: &Caller) -> Value {
    match super::runtime() {
        Some(runtime) => handle_with(&LiveDeps(runtime), tool, input, caller).await,
        None => failure(
            tool,
            "assistants cannot be set up from this Codeg process.".to_string(),
        ),
    }
}

/// The answer for a call whose companion token is no longer valid.
pub fn session_ended(tool: &str) -> Value {
    failure(
        tool,
        "this Codeg session has ended, so assistants cannot be set up from it.".to_string(),
    )
}

pub async fn handle_with(deps: &dyn Deps, tool: &str, input: Value, caller: &Caller) -> Value {
    if !deps.enabled() {
        // A soft refusal, like the upstream authoring tools: the user switched
        // the tools off after this agent started, and the model should tell
        // them rather than treat it as a failed call to retry.
        return json!({
            "text": format!(
                "{} The user has switched off \"Create assistants\" in Settings → Agent tools. \
                 Tell them, and let them set the assistant up in Settings → Collaboration → \
                 Assistants, or turn the switch back on.",
                verb_failed(tool)
            ),
            "is_error": false,
        });
    }
    let result = match tool {
        "create_assistant" => create(deps, &input, caller).await,
        "update_assistant" => update(deps, &input, caller).await,
        other => Err(format!("unknown tool {other}.")),
    };
    match result {
        Ok(outcome) => outcome,
        Err(why) => failure(tool, why),
    }
}

fn verb_failed(tool: &str) -> &'static str {
    if tool == "update_assistant" {
        "Not updated:"
    } else {
        "Not created:"
    }
}

fn failure(tool: &str, why: String) -> Value {
    json!({ "text": format!("{} {why}", verb_failed(tool)), "is_error": true })
}

// --- arguments -------------------------------------------------------------

fn text_arg(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// A free-text field the call may set to empty on purpose (an update clearing
/// the description): present-and-empty is `Some("")`.
fn optional_text(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
}

fn bool_arg(input: &Value, key: &str) -> Option<bool> {
    match input.get(key) {
        Some(Value::Bool(b)) => Some(*b),
        Some(Value::String(s)) => match s.trim().to_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn option_value(key: &str, value: &Value) -> Result<String, String> {
    match value {
        Value::String(s) => Ok(s.clone()),
        Value::Bool(b) => Ok(b.to_string()),
        Value::Number(n) => Ok(n.to_string()),
        _ => Err(format!(
            "the value of option \"{key}\" must be a string, a number or true/false."
        )),
    }
}

/// `options` as the schema asks — `[{option, value}, …]` — or as an object of
/// option → value, which models send often enough.
fn requested(input: &Value) -> Result<Requested, String> {
    let mut options = Vec::new();
    match input.get("options") {
        None | Some(Value::Null) => {}
        Some(Value::Array(pairs)) => {
            for pair in pairs {
                let key = pair
                    .get("option")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|k| !k.is_empty())
                    .ok_or(
                        "each entry of options needs an option and a value, e.g. \
                         {\"option\": \"reasoning_effort\", \"value\": \"high\"}.",
                    )?;
                let value = pair
                    .get("value")
                    .ok_or_else(|| format!("option \"{key}\" has no value."))?;
                options.push((key.to_string(), option_value(key, value)?));
            }
        }
        Some(Value::Object(map)) => {
            for (key, value) in map {
                options.push((key.clone(), option_value(key, value)?));
            }
        }
        Some(_) => {
            return Err("options must be a list of {option, value} pairs, e.g. \
                 [{\"option\": \"reasoning_effort\", \"value\": \"high\"}]."
                .to_string())
        }
    }
    Ok(Requested {
        model: text_arg(input, "model"),
        mode: text_arg(input, "mode"),
        options,
    })
}

// --- agents ----------------------------------------------------------------

fn agent_label(agent_type: AgentType) -> String {
    crate::acp::registry::get_agent_meta(agent_type)
        .name
        .to_string()
}

fn squash(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// The agent `raw` names: a wire slug (`codex`, `custom:…`), or a built-in
/// agent's name as Codeg shows it ("Codex CLI", "claude code").
fn parse_agent(raw: &str) -> Result<AgentType, String> {
    let raw = raw.trim();
    if let Some(agent) =
        AgentType::from_wire(raw).or_else(|| AgentType::from_wire(&raw.to_lowercase()))
    {
        return Ok(agent);
    }
    let wanted = squash(raw);
    let found = BUILTIN_AGENT_TYPES.iter().copied().find(|agent| {
        let label = squash(&agent_label(*agent));
        !wanted.is_empty()
            && (squash(&agent.as_wire()) == wanted
                || label == wanted
                || label.strip_suffix("cli") == Some(wanted.as_str()))
    });
    found.ok_or_else(|| {
        let known: Vec<String> = BUILTIN_AGENT_TYPES
            .iter()
            .map(|a| format!("{} ({})", a.as_wire(), agent_label(*a)))
            .collect();
        format!(
            "there is no agent \"{raw}\". Pass agent_type as one of: {}.",
            known.join(", ")
        )
    })
}

/// Refuse an agent the user switched off in Settings → Agents: an assistant
/// on it could not be delegated to.
async fn ensure_agent_enabled(db: &AppDatabase, agent_type: AgentType) -> Result<(), String> {
    let rows = agent_setting_service::list(&db.conn)
        .await
        .map_err(|e| format!("could not read the agent settings ({e})."))?;
    let off = rows.iter().any(|row| {
        !row.enabled && serde_json::from_str::<AgentType>(&row.agent_type).ok() == Some(agent_type)
    });
    if off {
        return Err(format!(
            "{} is switched off in Settings → Agents. Ask the user to turn it on, or pick \
             another agent.",
            agent_label(agent_type)
        ));
    }
    Ok(())
}

/// The current value of option `id` in a snapshot.
fn current_value(snapshot: &AgentOptionsSnapshot, id: &str) -> Option<String> {
    snapshot
        .config_options
        .iter()
        .find(|o| o.id == id)
        .map(|o| match &o.kind {
            SessionConfigKindInfo::Select(s) => s.current_value.clone(),
            SessionConfigKindInfo::Boolean(b) => b.current_value.to_string(),
        })
}

/// Probe `agent_type` and resolve the selection. A model — the one asked
/// for, or failing that the one an update keeps — is applied before the
/// options are read, because some agents offer different options per model
/// (opencode lists the effort levels per model), exactly as the editor
/// re-probes once a model is picked.
async fn probe_and_resolve(
    deps: &dyn Deps,
    caller: &Caller,
    agent_type: AgentType,
    requested: &Requested,
    previous: Option<&crate::acp::delegation::types::AgentDelegationDefaults>,
) -> Result<Resolved, String> {
    let label = agent_label(agent_type);
    let first = deps
        .probe(agent_type, &caller.working_dir, BTreeMap::new())
        .await
        .map_err(|e| format!("could not read {label}'s options: {e}"))?;
    let model = match selection::resolve_model(&label, &first, requested.model.as_deref())? {
        Some(pick) => Some(pick),
        None => previous.and_then(|prev| {
            let id = selection::MODEL_OPTION_ID;
            prev.config_values
                .get(id)
                .map(|v| (id.to_string(), v.clone()))
        }),
    };
    let snapshot = match model {
        Some((id, value)) if current_value(&first, &id).as_deref() != Some(value.as_str()) => {
            let applied = deps
                .probe(
                    agent_type,
                    &caller.working_dir,
                    BTreeMap::from([(id.clone(), value.clone())]),
                )
                .await
                .map_err(|e| format!("could not read {label}'s options for model {value}: {e}"))?;
            if requested.model.is_some() && applied.unapplied_config_ids.iter().any(|u| u == &id) {
                return Err(format!(
                    "{label} did not switch to model {value}, so the options that depend on it \
                     could not be read. Try again, or pick another model."
                ));
            }
            applied
        }
        _ => first,
    };
    selection::resolve(agent_type, &label, &snapshot, requested, previous)
}

// --- avatars ---------------------------------------------------------------

fn check_color(color: &str) -> Result<String, String> {
    let color = color.trim().to_lowercase();
    if ASSISTANT_AVATAR_COLORS.contains(&color.as_str()) {
        Ok(color)
    } else {
        Err(format!(
            "avatar_color must be one of: {}.",
            ASSISTANT_AVATAR_COLORS.join(", ")
        ))
    }
}

fn avatar_color_of(avatar: &AssistantAvatar) -> Option<&str> {
    match avatar {
        AssistantAvatar::Monogram { color } | AssistantAvatar::Emoji { color, .. } => {
            Some(color.as_str())
        }
        AssistantAvatar::Image { .. } => None,
    }
}

/// The avatar a call asks for. `None` when it asks for no change. An empty
/// `avatar_emoji` goes back to the name's monogram.
fn requested_avatar(
    input: &Value,
    name: &str,
    current: Option<&AssistantAvatar>,
) -> Result<Option<AssistantAvatar>, String> {
    let emoji = optional_text(input, "avatar_emoji");
    let color = match text_arg(input, "avatar_color") {
        Some(raw) => Some(check_color(&raw)?),
        None => None,
    };
    if emoji.is_none() && color.is_none() {
        return Ok(match current {
            Some(_) => None,
            None => Some(AssistantAvatar::Monogram {
                color: super::color_for_name(name).to_string(),
            }),
        });
    }
    let color = color
        .or_else(|| current.and_then(avatar_color_of).map(str::to_string))
        .unwrap_or_else(|| super::color_for_name(name).to_string());
    match emoji {
        Some(emoji) if !emoji.is_empty() => Ok(Some(AssistantAvatar::Emoji { emoji, color })),
        Some(_) => Ok(Some(AssistantAvatar::Monogram { color })),
        None => match current {
            Some(AssistantAvatar::Emoji { emoji, .. }) => Ok(Some(AssistantAvatar::Emoji {
                emoji: emoji.clone(),
                color,
            })),
            Some(AssistantAvatar::Image { .. }) => Err(
                "the assistant has a picture as its avatar, which has no colour. Pass \
                 avatar_emoji to replace the picture, or leave the avatar alone."
                    .to_string(),
            ),
            _ => Ok(Some(AssistantAvatar::Monogram { color })),
        },
    }
}

// --- create ----------------------------------------------------------------

async fn create(deps: &dyn Deps, input: &Value, caller: &Caller) -> Result<Value, String> {
    let name = text_arg(input, "name").ok_or("name is required.")?;
    let agent_raw = text_arg(input, "agent_type").ok_or(
        "agent_type is required: the agent the assistant runs on, e.g. \"codex\" or \"claude_code\".",
    )?;
    let agent_type = parse_agent(&agent_raw)?;
    let requested = requested(input)?;
    let avatar = requested_avatar(input, &name, None)?.expect("a new assistant always gets one");
    // The cheap refusals before the probe, which launches the agent.
    if name.chars().count() > assistant_service::MAX_NAME_CHARS {
        return Err(format!(
            "the name is longer than {} characters.",
            assistant_service::MAX_NAME_CHARS
        ));
    }
    let live = live_assistants(deps.db()).await?;
    if let Some(taken) = live
        .iter()
        .find(|a| assistant_service::name_key(&a.name) == assistant_service::name_key(&name))
    {
        return Err(format!(
            "an assistant named \"{}\" already exists (assistant_id={}). Pick another name, or \
             change that one with update_assistant.",
            taken.name, taken.id
        ));
    }
    ensure_agent_enabled(deps.db(), agent_type).await?;

    let resolved = probe_and_resolve(deps, caller, agent_type, &requested, None).await?;
    let draft = AssistantDraft {
        name,
        description: optional_text(input, "description").unwrap_or_default(),
        avatar,
        agent_config: resolved.config.clone(),
        instructions: optional_text(input, "instructions").unwrap_or_default(),
        enabled: bool_arg(input, "enabled").unwrap_or(true),
    };
    let saved =
        crate::commands::assistants::assistant_create_core(deps.emitter(), deps.db(), draft)
            .await
            .map_err(|e| format!("{e}."))?;

    let mut text = format!(
        "Created assistant \"{}\" (assistant_id={}), running on {}{}.",
        saved.name,
        saved.id,
        saved.label_snapshot.agent,
        if saved.enabled { "" } else { ", switched off" }
    );
    push_picks(&mut text, &resolved.picks, &saved.label_snapshot.agent);
    text.push_str(&format!(
        "\nThe user can now @-mention it in any conversation as [@{name}](codeg://assistant/{id}). \
         To hand it work yourself, call delegate_to_agent with assistant_id {id} (when \
         multi-agent delegation is on). The user can change or delete it from this tool call's \
         card or in Settings → Collaboration → Assistants.",
        name = saved.name,
        id = saved.id
    ));
    Ok(json!({ "text": text, "is_error": false, "assistant_id": saved.id }))
}

/// "Set as asked: … / Kept: … / Left at X's defaults: …", one line each.
fn push_picks(text: &mut String, picks: &[Pick], agent: &str) {
    let line = |source: PickSource| -> Option<String> {
        let parts: Vec<String> = picks
            .iter()
            .filter(|p| p.source == source)
            .map(|p| format!("{}: {}", p.name, p.value_label))
            .collect();
        (!parts.is_empty()).then(|| parts.join(" · "))
    };
    if let Some(asked) = line(PickSource::Requested) {
        text.push_str(&format!("\nSet as asked: {asked}"));
    }
    if let Some(kept) = line(PickSource::Kept) {
        text.push_str(&format!("\nKept: {kept}"));
    }
    if let Some(defaults) = line(PickSource::Default) {
        text.push_str(&format!("\nLeft at {agent}'s defaults: {defaults}"));
    }
}

async fn live_assistants(db: &AppDatabase) -> Result<Vec<AssistantInfo>, String> {
    assistant_service::list_all(&db.conn)
        .await
        .map(|all| all.into_iter().filter(AssistantInfo::is_live).collect())
        .map_err(|e| format!("could not read the assistants ({e})."))
}

// --- update ----------------------------------------------------------------

/// The assistant `raw` names: its id (a number, or a `codeg://assistant/N`
/// link), or its exact name.
fn find_assistant<'a>(live: &'a [AssistantInfo], raw: &Value) -> Result<&'a AssistantInfo, String> {
    let id = match raw {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => {
            let s = s.trim();
            let tail = s.rsplit('/').next().unwrap_or(s);
            tail.parse::<i64>().ok().filter(|_| {
                s.chars().all(|c| c.is_ascii_digit()) || s.starts_with("codeg://assistant/")
            })
        }
        _ => None,
    };
    let found = match (id, raw.as_str()) {
        (Some(id), _) => live.iter().find(|a| i64::from(a.id) == id),
        (None, Some(name)) => {
            let key = assistant_service::name_key(name.trim().trim_start_matches('@'));
            live.iter()
                .find(|a| assistant_service::name_key(&a.name) == key)
        }
        (None, None) => None,
    };
    found.ok_or_else(|| {
        let known: Vec<String> = live
            .iter()
            .map(|a| format!("\"{}\" (assistant_id={})", a.name, a.id))
            .collect();
        if known.is_empty() {
            "the user has no assistants yet; create one with create_assistant.".to_string()
        } else {
            format!(
                "no assistant matches {raw}. The user's assistants: {}.",
                known.join(", ")
            )
        }
    })
}

async fn update(deps: &dyn Deps, input: &Value, caller: &Caller) -> Result<Value, String> {
    let target = input
        .get("assistant")
        .filter(|v| !v.is_null())
        .ok_or("assistant is required: the assistant's id or its name.")?;
    let live = live_assistants(deps.db()).await?;
    let current = find_assistant(&live, target)?.clone();

    let requested = requested(input)?;
    let new_name = text_arg(input, "name");
    let mut patch = AssistantPatch {
        name: new_name.clone(),
        description: optional_text(input, "description"),
        instructions: optional_text(input, "instructions"),
        enabled: bool_arg(input, "enabled"),
        avatar: requested_avatar(
            input,
            new_name.as_deref().unwrap_or(&current.name),
            Some(&current.avatar),
        )?,
        agent_config: None,
    };

    let agent_raw = text_arg(input, "agent_type");
    let mut resolved: Option<Resolved> = None;
    if agent_raw.is_some() || !requested.is_empty() {
        let agent_type = match agent_raw {
            Some(raw) => parse_agent(&raw)?,
            None => current.agent_type,
        };
        ensure_agent_enabled(deps.db(), agent_type).await?;
        let previous = (agent_type == current.agent_type).then_some(&current.agent_options);
        let r = probe_and_resolve(deps, caller, agent_type, &requested, previous).await?;
        patch.agent_config = Some(r.config.clone());
        resolved = Some(r);
    }

    if patch.is_empty() {
        return Err(
            "nothing to change. Pass at least one of: name, description, instructions, \
             agent_type, model, mode, options, avatar_emoji, avatar_color, enabled."
                .to_string(),
        );
    }
    let changed = changed_fields(&patch);
    let saved = crate::commands::assistants::assistant_update_core(
        deps.emitter(),
        deps.db(),
        current.id,
        patch,
    )
    .await
    .map_err(|e| format!("{e}."))?;

    let mut text = format!(
        "Updated assistant \"{}\" (assistant_id={}): changed {}.",
        saved.name,
        saved.id,
        changed.join(", ")
    );
    if let Some(r) = &resolved {
        text.push_str(&format!("\nIt runs on {}.", saved.label_snapshot.agent));
        push_picks(&mut text, &r.picks, &saved.label_snapshot.agent);
    }
    if !saved.enabled {
        text.push_str("\nIt is switched off, so it cannot be delegated to until it is turned on.");
    }
    text.push_str(&format!(
        "\nMention it as [@{name}](codeg://assistant/{id}).",
        name = saved.name,
        id = saved.id
    ));
    Ok(json!({ "text": text, "is_error": false, "assistant_id": saved.id }))
}

fn changed_fields(patch: &AssistantPatch) -> Vec<&'static str> {
    let mut out = Vec::new();
    if patch.name.is_some() {
        out.push("name");
    }
    if patch.description.is_some() {
        out.push("description");
    }
    if patch.avatar.is_some() {
        out.push("avatar");
    }
    if patch.agent_config.is_some() {
        out.push("agent and options");
    }
    if patch.instructions.is_some() {
        out.push("instructions");
    }
    if patch.enabled.is_some() {
        out.push("enabled");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::types::{
        SessionConfigOptionInfo, SessionConfigSelectInfo, SessionConfigSelectOptionInfo,
    };
    use std::sync::Mutex;

    /// Codex-like agent: per-model effort lists, like opencode — the effort
    /// list depends on the model applied, which is what the re-probe is for.
    struct FakeDeps {
        db: AppDatabase,
        emitter: EventEmitter,
        enabled: bool,
        probes: Mutex<Vec<BTreeMap<String, String>>>,
    }

    fn select(id: &str, current: &str, values: &[&str]) -> SessionConfigOptionInfo {
        SessionConfigOptionInfo {
            id: id.into(),
            name: match id {
                "model" => "Model".into(),
                "reasoning_effort" => "Reasoning Effort".into(),
                other => other.into(),
            },
            description: None,
            category: None,
            kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
                current_value: current.into(),
                options: values
                    .iter()
                    .map(|v| SessionConfigSelectOptionInfo {
                        value: (*v).into(),
                        name: v.to_uppercase(),
                        description: None,
                    })
                    .collect(),
                groups: Vec::new(),
            }),
            recommended_value: None,
        }
    }

    #[async_trait]
    impl Deps for FakeDeps {
        fn enabled(&self) -> bool {
            self.enabled
        }
        fn db(&self) -> &AppDatabase {
            &self.db
        }
        fn emitter(&self) -> &EventEmitter {
            &self.emitter
        }
        async fn probe(
            &self,
            agent_type: AgentType,
            _working_dir: &Path,
            values: BTreeMap<String, String>,
        ) -> Result<AgentOptionsSnapshot, String> {
            if agent_type == AgentType::Gemini {
                return Err("Gemini CLI is not installed".into());
            }
            self.probes.lock().unwrap().push(values.clone());
            let model = values.get("model").cloned();
            let efforts: &[&str] = match model.as_deref() {
                Some("mini") => &["low", "medium"],
                _ => &["low", "medium", "high"],
            };
            let mut unapplied = Vec::new();
            if model.as_deref() == Some("broken") {
                unapplied.push("model".to_string());
            }
            Ok(AgentOptionsSnapshot {
                modes: None,
                config_options: vec![
                    select("model", "big", &["big", "mini", "broken"]),
                    select("reasoning_effort", "medium", efforts),
                ],
                available_commands: Vec::new(),
                prompt_capabilities: None,
                unapplied_config_ids: unapplied,
            })
        }
    }

    async fn deps() -> FakeDeps {
        deps_with_db().await
    }

    async fn deps_with_db() -> FakeDeps {
        FakeDeps {
            db: crate::db::test_helpers::fresh_in_memory_db().await,
            emitter: EventEmitter::Noop,
            enabled: true,
            probes: Mutex::new(Vec::new()),
        }
    }

    fn caller() -> Caller {
        Caller {
            working_dir: PathBuf::from("/work"),
        }
    }

    fn text(outcome: &Value) -> &str {
        outcome["text"].as_str().unwrap()
    }

    #[tokio::test]
    async fn create_saves_a_complete_assistant_and_says_how_to_use_it() {
        let deps = deps().await;
        let out = handle_with(
            &deps,
            "create_assistant",
            json!({
                "name": "Reviewer",
                "agent_type": "Codex CLI",
                "model": "MINI",
                "description": "Reviews diffs",
                "instructions": "Lead with the verdict.",
                "avatar_emoji": "🦉",
            }),
            &caller(),
        )
        .await;
        assert_eq!(out["is_error"], false, "{out}");
        let id = out["assistant_id"].as_i64().unwrap() as i32;
        let t = text(&out);
        assert!(
            t.starts_with(&format!(
                "Created assistant \"Reviewer\" (assistant_id={id})"
            )),
            "{t}"
        );
        assert!(t.contains("Set as asked: Model: MINI"), "{t}");
        assert!(
            t.contains("Left at Codex CLI's defaults: Reasoning Effort: MEDIUM"),
            "{t}"
        );
        assert!(
            t.contains(&format!("[@Reviewer](codeg://assistant/{id})")),
            "{t}"
        );
        // The model was applied before the options were read.
        assert_eq!(
            deps.probes
                .lock()
                .unwrap()
                .last()
                .unwrap()
                .get("model")
                .map(String::as_str),
            Some("mini")
        );

        let saved = assistant_service::get(&deps.db.conn, id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.agent_type, AgentType::Codex);
        assert_eq!(saved.agent_options.config_values["model"], "mini");
        assert_eq!(
            saved.agent_options.config_values["reasoning_effort"],
            "medium"
        );
        assert_eq!(saved.instructions, "Lead with the verdict.");
        assert_eq!(saved.description, "Reviews diffs");
        assert!(saved.enabled);
        assert_eq!(
            saved.avatar,
            AssistantAvatar::Emoji {
                emoji: "🦉".into(),
                color: crate::assistant_tools::color_for_name("Reviewer").into()
            }
        );
    }

    #[tokio::test]
    async fn create_refuses_before_probing_what_cannot_be_saved() {
        let deps = deps().await;
        let first = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "Reviewer", "agent_type": "codex"}),
            &caller(),
        )
        .await;
        assert_eq!(first["is_error"], false, "{first}");
        let probes = deps.probes.lock().unwrap().len();

        let dup = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "reviewer", "agent_type": "codex"}),
            &caller(),
        )
        .await;
        assert_eq!(dup["is_error"], true);
        assert!(
            text(&dup).starts_with("Not created: an assistant named \"Reviewer\""),
            "{dup}"
        );

        let bad_agent = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "X", "agent_type": "gpt"}),
            &caller(),
        )
        .await;
        assert!(
            text(&bad_agent).contains("codex (Codex CLI)"),
            "{bad_agent}"
        );

        let bad_color = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "X", "agent_type": "codex", "avatar_color": "mauve"}),
            &caller(),
        )
        .await;
        assert!(text(&bad_color).contains("slate, red"), "{bad_color}");
        assert_eq!(
            deps.probes.lock().unwrap().len(),
            probes,
            "no probe for any of them"
        );
    }

    #[tokio::test]
    async fn create_reports_probe_and_option_problems() {
        let deps = deps().await;
        let not_installed = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "G", "agent_type": "gemini"}),
            &caller(),
        )
        .await;
        assert!(
            text(&not_installed).contains("could not read"),
            "{not_installed}"
        );
        assert!(
            text(&not_installed).contains("not installed"),
            "{not_installed}"
        );

        let bad_model = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "C", "agent_type": "codex", "model": "o9"}),
            &caller(),
        )
        .await;
        assert!(text(&bad_model).contains("no model \"o9\""), "{bad_model}");

        let not_switched = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "C", "agent_type": "codex", "model": "broken"}),
            &caller(),
        )
        .await;
        assert!(
            text(&not_switched).contains("did not switch"),
            "{not_switched}"
        );

        // The effort list of the model asked for, not of the agent's default.
        let wrong_effort = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "C", "agent_type": "codex", "model": "mini", "options": {"Reasoning Effort": "high"}}),
            &caller(),
        )
        .await;
        assert!(
            text(&wrong_effort).contains("no value \"high\""),
            "{wrong_effort}"
        );
        assert!(live_assistants(&deps.db).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_switched_off_agent_or_tool_is_refused() {
        let deps = deps().await;
        if agent_setting_service::update_preferences(&deps.db.conn, AgentType::Codex, false, None)
            .await
            .is_err()
        {
            use sea_orm::{ActiveModelTrait, NotSet, Set};
            crate::db::entities::agent_setting::ActiveModel {
                id: NotSet,
                agent_type: Set(serde_json::to_string(&AgentType::Codex).unwrap()),
                registry_id: Set("codex".into()),
                enabled: Set(false),
                sort_order: Set(0),
                installed_version: Set(None),
                env_json: Set(None),
                model_provider_id: Set(None),
                created_at: Set(chrono::Utc::now()),
                updated_at: Set(chrono::Utc::now()),
            }
            .insert(&deps.db.conn)
            .await
            .unwrap();
        }
        let off = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "C", "agent_type": "codex"}),
            &caller(),
        )
        .await;
        assert!(
            text(&off).contains("switched off in Settings → Agents"),
            "{off}"
        );
        assert!(deps.probes.lock().unwrap().is_empty());

        let tools_off = FakeDeps {
            enabled: false,
            ..deps_with_db().await
        };
        let refused = handle_with(
            &tools_off,
            "create_assistant",
            json!({"name": "C", "agent_type": "claude_code"}),
            &caller(),
        )
        .await;
        assert_eq!(refused["is_error"], false);
        assert!(
            text(&refused).contains("switched off \"Create assistants\""),
            "{refused}"
        );
    }

    #[tokio::test]
    async fn update_changes_only_what_it_names_and_keeps_other_picks() {
        let deps = deps().await;
        let created = handle_with(
            &deps,
            "create_assistant",
            json!({"name": "Reviewer", "agent_type": "codex", "options": {"reasoning_effort": "high"}, "avatar_emoji": "🦉"}),
            &caller(),
        )
        .await;
        let id = created["assistant_id"].as_i64().unwrap();

        // Instructions only: no probe, options untouched.
        let probes = deps.probes.lock().unwrap().len();
        let out = handle_with(
            &deps,
            "update_assistant",
            json!({"assistant": "@reviewer", "instructions": "Be terse."}),
            &caller(),
        )
        .await;
        assert_eq!(out["is_error"], false, "{out}");
        assert!(text(&out).contains("changed instructions."), "{out}");
        assert_eq!(deps.probes.lock().unwrap().len(), probes);

        // A new effort by link: the model is kept, and applied for the probe.
        let out = handle_with(
            &deps,
            "update_assistant",
            json!({"assistant": format!("codeg://assistant/{id}"), "options": [{"option": "Reasoning Effort", "value": "low"}], "avatar_color": "teal"}),
            &caller(),
        )
        .await;
        assert_eq!(out["is_error"], false, "{out}");
        let t = text(&out);
        assert!(t.contains("Set as asked: Reasoning Effort: LOW"), "{t}");
        assert!(t.contains("Kept: Model: BIG"), "{t}");
        let saved = assistant_service::get(&deps.db.conn, id as i32)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.instructions, "Be terse.");
        assert_eq!(saved.agent_options.config_values["reasoning_effort"], "low");
        assert_eq!(
            saved.avatar,
            AssistantAvatar::Emoji {
                emoji: "🦉".into(),
                color: "teal".into()
            }
        );

        // Moving to the small model drops a kept effort it does not offer.
        let out = handle_with(
            &deps,
            "update_assistant",
            json!({"assistant": id, "model": "mini", "options": {"reasoning_effort": "medium"}}),
            &caller(),
        )
        .await;
        assert_eq!(out["is_error"], false, "{out}");

        let none = handle_with(
            &deps,
            "update_assistant",
            json!({"assistant": id}),
            &caller(),
        )
        .await;
        assert!(text(&none).contains("nothing to change"), "{none}");
        let missing = handle_with(
            &deps,
            "update_assistant",
            json!({"assistant": "Nobody", "name": "x"}),
            &caller(),
        )
        .await;
        assert!(
            text(&missing).contains("\"Reviewer\" (assistant_id="),
            "{missing}"
        );
    }
}
