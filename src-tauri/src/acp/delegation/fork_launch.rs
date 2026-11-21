//! keh4l build: what a `delegate_to_agent` call may ask for on top of the
//! upstream arguments — `isolation`, `model`, `config` — and how those layer
//! over the assistant's / settings' launch options.
//!
//! Precedence, per option: the call's own value > the @assistant's > the
//! settings' per-agent default > the agent's own default. Unlike the upstream
//! assistant-vs-settings choice (one replaces the other wholesale), the call's
//! values are laid OVER whichever of those two was chosen, so asking for a
//! model keeps the assistant's reasoning level.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::acp::types::{SessionConfigKindInfo, SessionConfigOptionInfo};

/// The config option id a model is chosen with.
pub const MODEL_OPTION_ID: &str = "model";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Isolation {
    /// The child works in the parent's directory (upstream behavior).
    #[default]
    Shared,
    /// The child works in a git worktree of its own (`super::worktree`).
    Worktree,
}

impl Isolation {
    pub fn as_str(self) -> &'static str {
        match self {
            Isolation::Shared => "shared",
            Isolation::Worktree => "worktree",
        }
    }
}

/// The keh4l-only arguments of one `delegate_to_agent` call.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForkDelegationExtras {
    #[serde(default)]
    pub isolation: Isolation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub config: BTreeMap<String, String>,
}

impl ForkDelegationExtras {
    /// Read them off the call's arguments. A malformed value is refused with
    /// a message for the agent, rather than ignored.
    pub fn from_args(input: &Value) -> Result<Self, String> {
        let isolation = match input.get("isolation") {
            None | Some(Value::Null) => Isolation::Shared,
            Some(Value::String(s)) => match s.trim() {
                "" | "shared" => Isolation::Shared,
                "worktree" => Isolation::Worktree,
                other => {
                    return Err(format!(
                        "isolation must be \"shared\" or \"worktree\", not {other:?}"
                    ))
                }
            },
            Some(_) => return Err("isolation must be a string".to_string()),
        };
        let model = match input.get("model") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) if s.trim().is_empty() => None,
            Some(Value::String(s)) => Some(s.trim().to_string()),
            Some(_) => return Err("model must be a string".to_string()),
        };
        let mut config = BTreeMap::new();
        match input.get("config") {
            None | Some(Value::Null) => {}
            Some(Value::Object(map)) => {
                for (key, value) in map {
                    let key = key.trim();
                    if key.is_empty() {
                        continue;
                    }
                    let value = match value {
                        Value::String(s) => s.trim().to_string(),
                        Value::Bool(b) => b.to_string(),
                        Value::Number(n) => n.to_string(),
                        _ => return Err(format!("config.{key} must be a string (the value's id)")),
                    };
                    if !value.is_empty() {
                        config.insert(key.to_string(), value);
                    }
                }
            }
            Some(_) => return Err("config must be an object of option id → value id".to_string()),
        }
        Ok(Self {
            isolation,
            model,
            config,
        })
    }

    /// The per-call option values, the model under [`MODEL_OPTION_ID`].
    pub fn requested_values(&self) -> BTreeMap<String, String> {
        let mut values = self.config.clone();
        if let Some(model) = &self.model {
            values.insert(MODEL_OPTION_ID.to_string(), model.clone());
        }
        values
    }

    pub fn is_empty(&self) -> bool {
        self.isolation == Isolation::Shared && self.model.is_none() && self.config.is_empty()
    }
}

/// Lay the call's values over the chosen launch options.
pub fn overlay(
    mode_id: Option<String>,
    mut config: BTreeMap<String, String>,
    extras: &ForkDelegationExtras,
) -> (Option<String>, BTreeMap<String, String>) {
    config.extend(extras.requested_values());
    (mode_id, config)
}

/// What came of the call's values once the child reported its options.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchCheck {
    /// Values the child does not hold: option id, asked value, what it offers.
    pub rejected: Vec<(String, String, Vec<String>)>,
    /// Options the child does not have at all.
    pub unknown: Vec<String>,
}

impl LaunchCheck {
    pub fn is_ok(&self) -> bool {
        self.rejected.is_empty()
    }

    /// For the agent: what was wrong and what to pick from.
    pub fn rejection_message(&self) -> String {
        let parts: Vec<String> = self
            .rejected
            .iter()
            .map(|(id, value, offered)| {
                if offered.is_empty() {
                    format!("{id} = {value:?} is not available")
                } else {
                    format!(
                        "{id} = {value:?} is not available; this agent offers: {}",
                        offered.join(", ")
                    )
                }
            })
            .collect();
        format!(
            "{}. The sub-agent was not started; delegate again with a value from the list, or \
             leave the option out to use the default.",
            parts.join("; ")
        )
    }

    /// For the ack: options this agent has no use for.
    pub fn unknown_note(&self) -> Option<String> {
        (!self.unknown.is_empty()).then(|| {
            format!(
                "This agent has no {} option, so that part of the request was ignored.",
                self.unknown.join(" / ")
            )
        })
    }
}

fn select_values(option: &SessionConfigOptionInfo) -> Option<(String, Vec<String>)> {
    match &option.kind {
        SessionConfigKindInfo::Select(select) => {
            let mut offered: Vec<String> = select.options.iter().map(|o| o.value.clone()).collect();
            for group in &select.groups {
                offered.extend(group.options.iter().map(|o| o.value.clone()));
            }
            Some((select.current_value.clone(), offered))
        }
        SessionConfigKindInfo::Boolean(b) => Some((
            b.current_value.to_string(),
            vec!["true".into(), "false".into()],
        )),
    }
}

/// Compare what was asked for with what the child now holds. A value is
/// accepted when the option's current value is it (the agent applied it), or
/// when the option lists it (an agent that takes a value without echoing it
/// as current).
pub fn check(
    requested: &BTreeMap<String, String>,
    options: &[SessionConfigOptionInfo],
) -> LaunchCheck {
    let mut out = LaunchCheck::default();
    for (id, value) in requested {
        let Some(option) = options.iter().find(|o| &o.id == id) else {
            out.unknown.push(id.clone());
            continue;
        };
        let Some((current, offered)) = select_values(option) else {
            continue;
        };
        if &current == value || offered.iter().any(|o| o == value) {
            continue;
        }
        out.rejected.push((id.clone(), value.clone(), offered));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::types::{SessionConfigSelectInfo, SessionConfigSelectOptionInfo};
    use serde_json::json;

    fn select(id: &str, current: &str, values: &[&str]) -> SessionConfigOptionInfo {
        SessionConfigOptionInfo {
            id: id.into(),
            name: id.into(),
            description: None,
            category: None,
            kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
                current_value: current.into(),
                options: values
                    .iter()
                    .map(|v| SessionConfigSelectOptionInfo {
                        value: (*v).into(),
                        name: (*v).into(),
                        description: None,
                    })
                    .collect(),
                groups: vec![],
            }),
            recommended_value: None,
        }
    }

    #[test]
    fn arguments_are_read_and_bad_ones_refused() {
        let extras = ForkDelegationExtras::from_args(&json!({
            "task": "x",
            "isolation": "worktree",
            "model": " gpt-6.2 ",
            "config": { "reasoning_effort": "high", "fast": true },
        }))
        .unwrap();
        assert_eq!(extras.isolation, Isolation::Worktree);
        assert_eq!(extras.model.as_deref(), Some("gpt-6.2"));
        assert_eq!(extras.config["reasoning_effort"], "high");
        assert_eq!(extras.config["fast"], "true");
        assert!(ForkDelegationExtras::from_args(&json!({}))
            .unwrap()
            .is_empty());
        assert!(ForkDelegationExtras::from_args(&json!({ "isolation": "docker" })).is_err());
        assert!(ForkDelegationExtras::from_args(&json!({ "config": ["x"] })).is_err());
    }

    #[test]
    fn the_call_overrides_one_option_and_keeps_the_rest() {
        let base = BTreeMap::from([
            ("model".to_string(), "gpt-6".to_string()),
            ("reasoning_effort".to_string(), "high".to_string()),
        ]);
        let extras = ForkDelegationExtras {
            model: Some("gpt-6.2-mini".into()),
            ..Default::default()
        };
        let (mode, config) = overlay(Some("auto".into()), base, &extras);
        assert_eq!(mode.as_deref(), Some("auto"));
        assert_eq!(config["model"], "gpt-6.2-mini");
        assert_eq!(config["reasoning_effort"], "high");
    }

    #[test]
    fn a_value_the_child_does_not_offer_is_rejected_with_the_choices() {
        let options = vec![
            select("model", "gpt-6.2", &["gpt-6.2", "gpt-6.2-mini"]),
            select("reasoning_effort", "medium", &["low", "medium", "high"]),
        ];
        let requested = BTreeMap::from([
            ("model".to_string(), "gpt-6".to_string()),
            ("reasoning_effort".to_string(), "high".to_string()),
            ("sandbox".to_string(), "off".to_string()),
        ]);
        let result = check(&requested, &options);
        assert!(!result.is_ok());
        assert_eq!(
            result.rejected,
            vec![(
                "model".to_string(),
                "gpt-6".to_string(),
                vec!["gpt-6.2".to_string(), "gpt-6.2-mini".to_string()]
            )]
        );
        assert_eq!(result.unknown, vec!["sandbox".to_string()]);
        assert!(result.rejection_message().contains("gpt-6.2, gpt-6.2-mini"));
        assert!(result.unknown_note().unwrap().contains("sandbox"));
    }
}
