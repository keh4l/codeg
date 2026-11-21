/**
 * keh4l build: how a delegated task was launched, as its card shows it — the
 * call's own `isolation` / `model` / `config` arguments (for the model the
 * agent asked for even before the backend answers) and the broker's
 * `codeg.delegation` meta (the worktree it made, the round of a continued
 * task).
 */

import type { DelegationWorktreeInfo } from "@/lib/types"

export interface DelegationLaunchFacts {
  model: string | null
  config: Record<string, string>
  isolation: "shared" | "worktree"
  worktree: DelegationWorktreeInfo | null
  round: number | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringMap(value: unknown): Record<string, string> {
  const obj = record(value)
  if (!obj) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(obj)) {
    if (typeof raw === "string" && raw.trim()) out[key] = raw.trim()
    else if (typeof raw === "boolean" || typeof raw === "number")
      out[key] = String(raw)
  }
  return out
}

function parseInput(input: string | null | undefined) {
  if (!input) return null
  try {
    return record(JSON.parse(input))
  } catch {
    return null
  }
}

function worktreeOf(value: unknown): DelegationWorktreeInfo | null {
  const obj = record(value)
  if (!obj) return null
  const { path, branch, base_sha, changes } = obj
  if (typeof path !== "string" || typeof branch !== "string") return null
  return {
    path,
    branch,
    base_sha: typeof base_sha === "string" ? base_sha : "",
    changes: typeof changes === "string" ? changes : null,
  }
}

/** The round a continuation's ack names ("round 2 of task …"). */
const ACK_ROUND_RE = /\bround (\d+) of task\b/

export function parseDelegationLaunch(
  input: string | null | undefined,
  meta: Record<string, unknown> | null | undefined,
  output?: string | null
): DelegationLaunchFacts {
  const args = parseInput(input)
  const inner = record(meta?.["codeg.delegation"])
  const model =
    (typeof inner?.model === "string" && inner.model) ||
    (typeof args?.model === "string" && args.model.trim()) ||
    null
  const config = { ...stringMap(args?.config), ...stringMap(inner?.config) }
  const worktree = worktreeOf(inner?.worktree)
  const isolation =
    worktree ||
    inner?.isolation === "worktree" ||
    args?.isolation === "worktree"
      ? "worktree"
      : "shared"
  const ackRound = output ? Number(ACK_ROUND_RE.exec(output)?.[1] ?? 0) : 0
  const round =
    typeof inner?.round === "number" && inner.round > 1
      ? inner.round
      : ackRound > 1
        ? ackRound
        : null
  return { model, config, isolation, worktree, round }
}

/** One short label for the model chip: the model and the option values. */
export function launchChipLabel(facts: DelegationLaunchFacts): string | null {
  const values = Object.entries(facts.config)
    .filter(([key]) => key !== "model")
    .map(([, value]) => value)
  const parts = [facts.model, ...values].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}

export function hasLaunchDetail(facts: DelegationLaunchFacts): boolean {
  return (
    facts.model !== null ||
    Object.keys(facts.config).length > 0 ||
    facts.isolation === "worktree"
  )
}

/** Whether a call drawn on the delegation card is a `continue_delegation`
 *  round: its arguments name the task it continues, never an agent. */
export function isContinuationCall(input: string | null | undefined): boolean {
  const args = parseInput(input)
  return (
    !!args &&
    typeof args.task_id === "string" &&
    args.agent_type === undefined &&
    args.assistant_id === undefined
  )
}

/**
 * The round of a continued task, from the prompt the sub-agent received for
 * it (`continuation_prompt` in
 * `src-tauri/src/acp/delegation/broker/continuation.rs`), or null.
 */
export function continuationRoundOf(text: string): number | null {
  const match = CONTINUATION_PROMPT_RE.exec(text)
  if (!match) return null
  const round = Number(match[1])
  return Number.isInteger(round) && round > 1 ? round : null
}

const CONTINUATION_PROMPT_RE =
  /^Follow-up from the agent that delegated this task to you \(round (\d+)\)\./
