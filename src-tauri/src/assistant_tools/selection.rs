//! Turning "Codex, GPT-5.5, high effort, read-only" into an assistant's
//! complete agent selection, against what the agent advertised in a probe.
//!
//! The editor's rules (`src/components/settings/agent-options-editor.tsx`,
//! `assistant-agent-config.ts`), applied without a person picking:
//!
//! - the rows are the agent's config options in its own order, plus a
//!   standalone mode row only when it advertises modes and no options;
//! - a select the agent offers no values for is neither required nor stored;
//! - every other row needs exactly one value it currently offers.
//!
//! A row the call names gets the value it names, matched against the value
//! ids first and the names the agent shows second, ignoring case and
//! punctuation. A row it does not name keeps `previous` (an update's current
//! pick) while the agent still offers it, and otherwise takes the agent's own
//! default — its current value, or the value it recommends.

use std::collections::BTreeMap;

use crate::acp::delegation::types::AgentDelegationDefaults;
use crate::acp::types::{
    AgentOptionsSnapshot, SessionConfigKindInfo, SessionConfigOptionInfo, SessionModeInfo,
};
use crate::models::{
    AssistantAgentConfig, AssistantLabelSnapshot, AssistantOptionKind, AssistantOptionLabel,
};

/// The model option's id when the agent uses the conventional one.
pub const MODEL_OPTION_ID: &str = "model";

/// How many choices an error lists before it says "and N more".
const LISTED_CHOICES: usize = 25;

/// The picks a call asks for, before they are matched against the agent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Requested {
    pub model: Option<String>,
    pub mode: Option<String>,
    /// Option (id or name) → value (id or name), in the order given.
    pub options: Vec<(String, String)>,
}

impl Requested {
    pub fn is_empty(&self) -> bool {
        self.model.is_none() && self.mode.is_none() && self.options.is_empty()
    }
}

/// One option of the resolved selection, for the tool's reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pick {
    pub name: String,
    pub value_label: String,
    /// Where the value came from.
    pub source: PickSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickSource {
    /// The call named it.
    Requested,
    /// The assistant's pick before this update, still offered.
    Kept,
    /// The agent's own default.
    Default,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub config: AssistantAgentConfig,
    pub picks: Vec<Pick>,
}

/// A value a row offers: what is stored, and what the agent calls it.
#[derive(Debug, Clone)]
struct Choice {
    value: String,
    name: String,
}

#[derive(Debug, Clone)]
enum RowKind {
    Mode,
    Select,
    Boolean,
}

#[derive(Debug, Clone)]
struct Row {
    kind: RowKind,
    /// The config option id; empty for the standalone mode row.
    id: String,
    name: String,
    category: Option<String>,
    choices: Vec<Choice>,
    /// The agent's own pick.
    current: Option<String>,
    recommended: Option<String>,
}

impl Row {
    fn offers(&self, value: &str) -> bool {
        match self.kind {
            RowKind::Boolean => value == "true" || value == "false",
            _ => self.choices.iter().any(|c| c.value == value),
        }
    }

    fn label_of(&self, value: &str) -> String {
        match self.kind {
            RowKind::Boolean => if value == "true" { "On" } else { "Off" }.to_string(),
            _ => self
                .choices
                .iter()
                .find(|c| c.value == value)
                .map(|c| c.name.clone())
                .unwrap_or_else(|| value.to_string()),
        }
    }

    fn is_model(&self) -> bool {
        matches!(self.kind, RowKind::Select)
            && (self.id == MODEL_OPTION_ID || self.category.as_deref() == Some("model"))
    }

    fn is_mode(&self) -> bool {
        match self.kind {
            RowKind::Mode => true,
            RowKind::Select => self.id == "mode" || self.category.as_deref() == Some("mode"),
            RowKind::Boolean => false,
        }
    }

    /// What it is called in an error: its name, with the id when they differ.
    fn display(&self) -> String {
        if self.id.is_empty() || same_words(&self.id, &self.name) {
            self.name.clone()
        } else {
            format!("{} ({})", self.name, self.id)
        }
    }
}

fn build_rows(snapshot: &AgentOptionsSnapshot) -> Vec<Row> {
    let mut rows = Vec::new();
    if snapshot.config_options.is_empty() {
        if let Some(modes) = snapshot
            .modes
            .as_ref()
            .filter(|m| !m.available_modes.is_empty())
        {
            rows.push(mode_row(&modes.available_modes, &modes.current_mode_id));
        }
    }
    rows.extend(snapshot.config_options.iter().map(option_row));
    rows
}

fn mode_row(modes: &[SessionModeInfo], current: &str) -> Row {
    Row {
        kind: RowKind::Mode,
        id: String::new(),
        name: "Mode".to_string(),
        category: Some("mode".to_string()),
        choices: modes
            .iter()
            .map(|m| Choice {
                value: m.id.clone(),
                name: m.name.clone(),
            })
            .collect(),
        current: Some(current.to_string()),
        recommended: None,
    }
}

fn option_row(option: &SessionConfigOptionInfo) -> Row {
    match &option.kind {
        SessionConfigKindInfo::Boolean(b) => Row {
            kind: RowKind::Boolean,
            id: option.id.clone(),
            name: option.name.clone(),
            category: option.category.clone(),
            choices: Vec::new(),
            current: Some(b.current_value.to_string()),
            recommended: option.recommended_value.clone(),
        },
        SessionConfigKindInfo::Select(select) => {
            // The flat list carries every value, grouped selects included;
            // the groups are only read when an agent sent nothing flat.
            let mut choices: Vec<Choice> = select
                .options
                .iter()
                .map(|o| Choice {
                    value: o.value.clone(),
                    name: o.name.clone(),
                })
                .collect();
            if choices.is_empty() {
                choices = select
                    .groups
                    .iter()
                    .flat_map(|g| g.options.iter())
                    .map(|o| Choice {
                        value: o.value.clone(),
                        name: o.name.clone(),
                    })
                    .collect();
            }
            Row {
                kind: RowKind::Select,
                id: option.id.clone(),
                name: option.name.clone(),
                category: option.category.clone(),
                choices,
                current: Some(select.current_value.clone()),
                recommended: option.recommended_value.clone(),
            }
        }
    }
}

/// Lowercase letters and digits only: "GPT 5.5" and "gpt-5.5" are one name.
fn squash(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn same_words(a: &str, b: &str) -> bool {
    let (a, b) = (squash(a), squash(b));
    !a.is_empty() && a == b
}

/// The value of `row` that `wanted` names: an exact id, then a name or id
/// ignoring case, then one ignoring punctuation too. `None` when nothing
/// matches, or when the loosest pass matches more than one.
fn match_value(row: &Row, wanted: &str) -> Option<String> {
    let wanted = wanted.trim();
    if let RowKind::Boolean = row.kind {
        return parse_bool(wanted).map(|b| b.to_string());
    }
    if let Some(c) = row.choices.iter().find(|c| c.value == wanted) {
        return Some(c.value.clone());
    }
    if let Some(c) = row
        .choices
        .iter()
        .find(|c| c.value.eq_ignore_ascii_case(wanted) || c.name.eq_ignore_ascii_case(wanted))
    {
        return Some(c.value.clone());
    }
    let loose: Vec<&Choice> = row
        .choices
        .iter()
        .filter(|c| same_words(&c.value, wanted) || same_words(&c.name, wanted))
        .collect();
    match loose.as_slice() {
        [one] => Some(one.value.clone()),
        _ => None,
    }
}

fn parse_bool(raw: &str) -> Option<bool> {
    match raw.trim().to_lowercase().as_str() {
        "true" | "on" | "yes" | "1" | "enabled" | "开" | "开启" | "打开" | "是" => Some(true),
        "false" | "off" | "no" | "0" | "disabled" | "关" | "关闭" | "否" => Some(false),
        _ => None,
    }
}

/// Which row an option name in the call means: its id, then its name.
fn find_row(rows: &[Row], key: &str) -> Option<usize> {
    let key = key.trim();
    rows.iter()
        .position(|r| !r.id.is_empty() && r.id == key)
        .or_else(|| {
            rows.iter()
                .position(|r| r.id.eq_ignore_ascii_case(key) || r.name.eq_ignore_ascii_case(key))
        })
        .or_else(|| {
            let hits: Vec<usize> = rows
                .iter()
                .enumerate()
                .filter(|(_, r)| same_words(&r.id, key) || same_words(&r.name, key))
                .map(|(i, _)| i)
                .collect();
            match hits.as_slice() {
                [one] => Some(*one),
                _ => None,
            }
        })
}

/// "GPT-5.5 (gpt-5.5, the default), GPT-5.4 (gpt-5.4), …"
fn list_choices(row: &Row) -> String {
    if let RowKind::Boolean = row.kind {
        return "on or off".to_string();
    }
    let default = default_value(row);
    let mut parts: Vec<String> = row
        .choices
        .iter()
        .take(LISTED_CHOICES)
        .map(|c| {
            let mut text = if same_words(&c.value, &c.name) {
                c.name.clone()
            } else {
                format!("{} ({})", c.name, c.value)
            };
            if default.as_deref() == Some(c.value.as_str()) {
                text.push_str(" — the default");
            }
            text
        })
        .collect();
    if row.choices.len() > LISTED_CHOICES {
        parts.push(format!("and {} more", row.choices.len() - LISTED_CHOICES));
    }
    parts.join(", ")
}

fn list_rows(rows: &[Row]) -> String {
    let names: Vec<String> = rows.iter().map(Row::display).collect();
    if names.is_empty() {
        "none".to_string()
    } else {
        names.join(", ")
    }
}

/// The agent's own pick for a row: its current value when it still offers it,
/// else the value it recommends, else the first it offers.
fn default_value(row: &Row) -> Option<String> {
    if let RowKind::Boolean = row.kind {
        return row
            .current
            .clone()
            .or_else(|| {
                row.recommended
                    .as_deref()
                    .and_then(parse_bool)
                    .map(|b| b.to_string())
            })
            .or_else(|| Some("false".to_string()));
    }
    row.current
        .as_deref()
        .filter(|v| row.offers(v))
        .or_else(|| row.recommended.as_deref().filter(|v| row.offers(v)))
        .map(str::to_string)
        .or_else(|| row.choices.first().map(|c| c.value.clone()))
}

/// The model option of a snapshot and the value `wanted` names in it — what
/// the caller re-probes with, so the other options are the ones that model
/// offers. `Ok(None)` when no model was asked for.
pub fn resolve_model(
    agent_label: &str,
    snapshot: &AgentOptionsSnapshot,
    wanted: Option<&str>,
) -> Result<Option<(String, String)>, String> {
    let Some(wanted) = wanted.map(str::trim).filter(|w| !w.is_empty()) else {
        return Ok(None);
    };
    let rows = build_rows(snapshot);
    let Some(row) = rows.iter().find(|r| r.is_model()) else {
        return Err(format!(
            "{agent_label} has no model option to pick \"{wanted}\" in. Its options: {}.",
            list_rows(&rows)
        ));
    };
    match match_value(row, wanted) {
        Some(value) => Ok(Some((row.id.clone(), value))),
        None => Err(format!(
            "{agent_label} has no model \"{wanted}\". Models it offers: {}.",
            list_choices(row)
        )),
    }
}

/// Resolve the complete selection. `previous` is the assistant's selection
/// before an update on the same agent; `None` for a new assistant or a
/// change of agent.
pub fn resolve(
    agent_type: crate::models::AgentType,
    agent_label: &str,
    snapshot: &AgentOptionsSnapshot,
    requested: &Requested,
    previous: Option<&AgentDelegationDefaults>,
) -> Result<Resolved, String> {
    let rows = build_rows(snapshot);
    // Row index → (value, the words the call used for it).
    let mut wanted: BTreeMap<usize, String> = BTreeMap::new();

    if let Some(model) = requested
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        let Some(i) = rows.iter().position(Row::is_model) else {
            return Err(format!(
                "{agent_label} has no model option to pick \"{model}\" in. Its options: {}.",
                list_rows(&rows)
            ));
        };
        wanted.insert(i, model.to_string());
    }
    if let Some(mode) = requested
        .mode
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        let Some(i) = rows.iter().position(Row::is_mode) else {
            return Err(format!(
                "{agent_label} has no mode to pick \"{mode}\" in. Its options: {}.",
                list_rows(&rows)
            ));
        };
        wanted.insert(i, mode.to_string());
    }
    for (key, value) in &requested.options {
        let Some(i) = find_row(&rows, key) else {
            return Err(format!(
                "{agent_label} has no option \"{}\". Its options: {}.",
                key.trim(),
                list_rows(&rows)
            ));
        };
        wanted.insert(i, value.clone());
    }

    let previous_value = |row: &Row| -> Option<String> {
        let prev = previous?;
        let value = match row.kind {
            RowKind::Mode => prev.mode_id.clone(),
            _ => prev.config_values.get(&row.id).cloned(),
        }?;
        row.offers(&value).then_some(value)
    };

    let mut mode_id: Option<String> = None;
    let mut mode_label: Option<String> = None;
    let mut config_values: BTreeMap<String, String> = BTreeMap::new();
    let mut labels: Vec<AssistantOptionLabel> = Vec::new();
    let mut picks: Vec<Pick> = Vec::new();

    for (i, row) in rows.iter().enumerate() {
        let required = !matches!(row.kind, RowKind::Select) || !row.choices.is_empty();
        let (value, source) = if let Some(raw) = wanted.get(&i) {
            if !required {
                return Err(format!(
                    "{agent_label} offers no values for {} right now, so \"{}\" cannot be picked.",
                    row.display(),
                    raw.trim()
                ));
            }
            match match_value(row, raw) {
                Some(value) => (value, PickSource::Requested),
                None => {
                    return Err(format!(
                        "{agent_label} has no value \"{}\" for {}. It offers: {}.",
                        raw.trim(),
                        row.display(),
                        list_choices(row)
                    ))
                }
            }
        } else if !required {
            continue;
        } else if let Some(value) = previous_value(row) {
            (value, PickSource::Kept)
        } else {
            match default_value(row) {
                Some(value) => (value, PickSource::Default),
                None => continue,
            }
        };
        let value_label = row.label_of(&value);
        picks.push(Pick {
            name: row.name.clone(),
            value_label: value_label.clone(),
            source,
        });
        match row.kind {
            RowKind::Mode => {
                mode_id = Some(value);
                mode_label = Some(value_label);
            }
            RowKind::Select | RowKind::Boolean => {
                labels.push(AssistantOptionLabel {
                    id: row.id.clone(),
                    kind: if matches!(row.kind, RowKind::Boolean) {
                        AssistantOptionKind::Boolean
                    } else {
                        AssistantOptionKind::Select
                    },
                    name: row.name.clone(),
                    value_label,
                });
                config_values.insert(row.id.clone(), value);
            }
        }
    }

    let config = AssistantAgentConfig {
        agent_type,
        agent_options: AgentDelegationDefaults {
            mode_id,
            config_values,
        },
        label_snapshot: AssistantLabelSnapshot {
            agent: agent_label.to_string(),
            mode: mode_label,
            options: labels,
        },
    };
    config.validate()?;
    Ok(Resolved { config, picks })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::types::{
        SessionConfigBooleanInfo, SessionConfigSelectGroupInfo, SessionConfigSelectInfo,
        SessionConfigSelectOptionInfo, SessionModeStateInfo,
    };
    use crate::models::AgentType;

    fn select(
        id: &str,
        name: &str,
        current: &str,
        values: &[(&str, &str)],
    ) -> SessionConfigOptionInfo {
        SessionConfigOptionInfo {
            id: id.into(),
            name: name.into(),
            description: None,
            category: None,
            kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
                current_value: current.into(),
                options: values
                    .iter()
                    .map(|(v, n)| SessionConfigSelectOptionInfo {
                        value: (*v).into(),
                        name: (*n).into(),
                        description: None,
                    })
                    .collect(),
                groups: Vec::new(),
            }),
            recommended_value: None,
        }
    }

    fn boolean(id: &str, name: &str, current: bool) -> SessionConfigOptionInfo {
        SessionConfigOptionInfo {
            id: id.into(),
            name: name.into(),
            description: None,
            category: None,
            kind: SessionConfigKindInfo::Boolean(SessionConfigBooleanInfo {
                current_value: current,
            }),
            recommended_value: None,
        }
    }

    fn snapshot(options: Vec<SessionConfigOptionInfo>) -> AgentOptionsSnapshot {
        AgentOptionsSnapshot {
            modes: None,
            config_options: options,
            available_commands: Vec::new(),
            prompt_capabilities: None,
            unapplied_config_ids: Vec::new(),
        }
    }

    fn codex() -> AgentOptionsSnapshot {
        let mut mode = select(
            "mode",
            "Approval Preset",
            "auto",
            &[
                ("read-only", "Read Only"),
                ("auto", "Default"),
                ("full-access", "Full Access"),
            ],
        );
        mode.category = Some("mode".into());
        snapshot(vec![
            mode,
            select(
                "model",
                "Model",
                "gpt-5.5",
                &[
                    ("gpt-5.5", "GPT-5.5"),
                    ("gpt-5.4", "GPT-5.4"),
                    ("gpt-5.4-mini", "GPT-5.4-Mini"),
                ],
            ),
            select(
                "reasoning_effort",
                "Reasoning Effort",
                "medium",
                &[("low", "Low"), ("medium", "Medium"), ("high", "High")],
            ),
            boolean("fast", "Fast mode", false),
        ])
    }

    fn requested(model: Option<&str>, mode: Option<&str>, options: &[(&str, &str)]) -> Requested {
        Requested {
            model: model.map(str::to_string),
            mode: mode.map(str::to_string),
            options: options
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    /// The prototype's request: model by its display name, effort and mode by
    /// loose names, the rest left to the agent.
    #[test]
    fn named_picks_win_and_the_rest_take_the_agent_defaults() {
        let req = requested(
            Some("GPT 5.5"),
            Some("read only"),
            &[("reasoning effort", "HIGH")],
        );
        let r = resolve(AgentType::Codex, "Codex CLI", &codex(), &req, None).unwrap();
        let values = &r.config.agent_options.config_values;
        assert_eq!(values["model"], "gpt-5.5");
        assert_eq!(values["mode"], "read-only");
        assert_eq!(values["reasoning_effort"], "high");
        assert_eq!(values["fast"], "false");
        assert_eq!(r.config.agent_options.mode_id, None);
        assert_eq!(r.config.label_snapshot.agent, "Codex CLI");
        let fast = r.picks.iter().find(|p| p.name == "Fast mode").unwrap();
        assert_eq!(fast.source, PickSource::Default);
        assert_eq!(fast.value_label, "Off");
        let effort = r
            .picks
            .iter()
            .find(|p| p.name == "Reasoning Effort")
            .unwrap();
        assert_eq!(
            (effort.value_label.as_str(), effort.source),
            ("High", PickSource::Requested)
        );
        assert!(r.config.validate().is_ok());
    }

    #[test]
    fn unknown_values_and_options_name_what_is_offered() {
        let err = resolve(
            AgentType::Codex,
            "Codex CLI",
            &codex(),
            &requested(Some("gpt-6"), None, &[]),
            None,
        )
        .unwrap_err();
        assert!(err.contains("no value \"gpt-6\" for Model"), "{err}");
        assert!(err.contains("GPT-5.5 — the default"), "{err}");
        assert!(err.contains("GPT-5.4-Mini"), "{err}");

        let err = resolve(
            AgentType::Codex,
            "Codex CLI",
            &codex(),
            &requested(None, None, &[("temperature", "0.2")]),
            None,
        )
        .unwrap_err();
        assert!(err.contains("no option \"temperature\""), "{err}");
        assert!(
            err.contains("Approval Preset (mode), Model, Reasoning Effort"),
            "{err}"
        );

        let err = resolve(
            AgentType::Codex,
            "Codex CLI",
            &codex(),
            &requested(None, None, &[("fast", "maybe")]),
            None,
        )
        .unwrap_err();
        assert!(err.contains("on or off"), "{err}");
    }

    /// An update on the same agent keeps the picks the call does not name —
    /// but only those the agent still offers.
    #[test]
    fn an_update_keeps_previous_picks_that_are_still_offered() {
        let previous = AgentDelegationDefaults {
            mode_id: None,
            config_values: [
                ("model", "gpt-5.4"),
                ("mode", "read-only"),
                ("reasoning_effort", "ultra"),
                ("fast", "true"),
            ]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        };
        let r = resolve(
            AgentType::Codex,
            "Codex CLI",
            &codex(),
            &requested(None, None, &[]),
            Some(&previous),
        )
        .unwrap();
        let values = &r.config.agent_options.config_values;
        assert_eq!(values["model"], "gpt-5.4");
        assert_eq!(values["mode"], "read-only");
        assert_eq!(values["fast"], "true");
        // Withdrawn by the agent: back to its default.
        assert_eq!(values["reasoning_effort"], "medium");
        let effort = r
            .picks
            .iter()
            .find(|p| p.name == "Reasoning Effort")
            .unwrap();
        assert_eq!(effort.source, PickSource::Default);
        let model = r.picks.iter().find(|p| p.name == "Model").unwrap();
        assert_eq!(model.source, PickSource::Kept);
    }

    /// An agent with modes and no options gets the standalone mode row; one
    /// with nothing at all yields an empty, valid selection.
    #[test]
    fn mode_only_and_empty_agents() {
        let mut snap = snapshot(Vec::new());
        snap.modes = Some(SessionModeStateInfo {
            current_mode_id: "default".into(),
            available_modes: vec![
                SessionModeInfo {
                    id: "default".into(),
                    name: "Default".into(),
                    description: None,
                },
                SessionModeInfo {
                    id: "plan".into(),
                    name: "Plan".into(),
                    description: None,
                },
            ],
        });
        let r = resolve(
            AgentType::ClaudeCode,
            "Claude Code",
            &snap,
            &requested(None, Some("plan"), &[]),
            None,
        )
        .unwrap();
        assert_eq!(r.config.agent_options.mode_id.as_deref(), Some("plan"));
        assert_eq!(r.config.label_snapshot.mode.as_deref(), Some("Plan"));

        let r = resolve(
            AgentType::Pi,
            "Pi",
            &snapshot(Vec::new()),
            &Requested::default(),
            None,
        )
        .unwrap();
        assert!(r.config.agent_options.config_values.is_empty());
        assert!(r.picks.is_empty());
        let err = resolve(
            AgentType::Pi,
            "Pi",
            &snapshot(Vec::new()),
            &requested(Some("x"), None, &[]),
            None,
        )
        .unwrap_err();
        assert!(err.contains("no model option"), "{err}");
    }

    /// A select with no values is skipped (not required, not stored); naming
    /// it is an error. Grouped values are read when the flat list is empty.
    #[test]
    fn empty_and_grouped_selects() {
        let mut grouped = select("model", "Model", "anthropic/sonnet", &[]);
        if let SessionConfigKindInfo::Select(s) = &mut grouped.kind {
            s.groups = vec![SessionConfigSelectGroupInfo {
                group: "anthropic".into(),
                name: "Anthropic".into(),
                options: vec![
                    SessionConfigSelectOptionInfo {
                        value: "anthropic/sonnet".into(),
                        name: "Sonnet".into(),
                        description: None,
                    },
                    SessionConfigSelectOptionInfo {
                        value: "anthropic/opus".into(),
                        name: "Opus".into(),
                        description: None,
                    },
                ],
            }];
        }
        let snap = snapshot(vec![grouped, select("variant", "Variant", "", &[])]);
        let r = resolve(
            AgentType::OpenCode,
            "OpenCode",
            &snap,
            &requested(Some("opus"), None, &[]),
            None,
        )
        .unwrap();
        assert_eq!(
            r.config.agent_options.config_values["model"],
            "anthropic/opus"
        );
        assert!(!r.config.agent_options.config_values.contains_key("variant"));

        let err = resolve(
            AgentType::OpenCode,
            "OpenCode",
            &snap,
            &requested(None, None, &[("variant", "high")]),
            None,
        )
        .unwrap_err();
        assert!(err.contains("offers no values for Variant"), "{err}");
    }

    #[test]
    fn a_loose_name_matching_two_values_is_refused() {
        let snap = snapshot(vec![select(
            "model",
            "Model",
            "a",
            &[("a", "GPT 5"), ("b", "gpt-5")],
        )]);
        assert!(resolve(
            AgentType::Codex,
            "Codex CLI",
            &snap,
            &requested(Some("GPT_5"), None, &[]),
            None
        )
        .is_err());
        // An exact (case-insensitive) name still decides it.
        let r = resolve(
            AgentType::Codex,
            "Codex CLI",
            &snap,
            &requested(Some("gpt-5"), None, &[]),
            None,
        )
        .unwrap();
        assert_eq!(r.config.agent_options.config_values["model"], "b");
    }

    #[test]
    fn resolve_model_finds_the_value_to_reprobe_with() {
        assert_eq!(resolve_model("Codex CLI", &codex(), None).unwrap(), None);
        assert_eq!(
            resolve_model("Codex CLI", &codex(), Some("gpt-5.4 mini")).unwrap(),
            Some(("model".to_string(), "gpt-5.4-mini".to_string()))
        );
        assert!(resolve_model("Codex CLI", &codex(), Some("o9")).is_err());
    }
}
