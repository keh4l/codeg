/**
 * keh4l build: what the compact (T3 Code style) view makes of a reply's
 * activity model — which steps a tool-call visibility level leaves, which
 * failures stay in view when the reply folds, how much the reply edited, and
 * how a reply still being written splits into prose and runs of steps.
 *
 * Pure functions over the upstream `ActivityModel` (`buildActivity`), so the
 * compact view never parses a reply on its own.
 */

import { combineStatuses, isFailureStatus } from "@/lib/activity/status"
import { summarizeActivity } from "@/lib/activity/summarize"
import type {
  ActivityItem,
  ActivityModel,
  ActivityStep,
  ToolStepKind,
} from "@/lib/activity/types"
import type { ToolCallVisibility } from "@/lib/chat-view-prefs"

type ToolStep = Extract<ActivityStep, { type: "tool" }>

/**
 * Tool calls a visibility level may hide: the agent's own work on the
 * workspace. Never hidden: sub-agents and delegations (they run on), questions,
 * plan approvals and feedback (they are the user's part), goals, compaction,
 * and a completion card (Cline's answer is that card).
 */
const HIDEABLE_KINDS: ReadonlySet<ToolStepKind> = new Set<ToolStepKind>([
  "read",
  "search",
  "glob",
  "list",
  "fetch",
  "web-search",
  "memory",
  "command",
  "shell-session",
  "script",
  "monitor",
  "network",
  "edit",
  "mcp",
  "generic",
  "skill",
  "todo",
  "workbench",
])

/** Exhaustive over the step types: a step type upstream adds fails the build
 *  here, so a fork sync has to decide whether a level may hide it. */
function stepIsHideableTool(step: ActivityStep): step is ToolStep {
  switch (step.type) {
    case "tool":
      return HIDEABLE_KINDS.has(step.tool.kind)
    case "thought":
    case "note":
    case "image":
    case "image-job":
    case "plan":
    case "delegation-polls":
    case "background-tasks":
    case "goal":
    case "tool-result":
      return false
    default: {
      const unhandled: never = step
      return unhandled
    }
  }
}

/** Does `level` hide this step? A call waiting on the user's answer never
 *  hides; nor does one still running under "hide successful" (it has not
 *  succeeded yet). */
export function stepHiddenBy(
  step: ActivityStep,
  level: ToolCallVisibility
): boolean {
  if (level === "showAll" || !stepIsHideableTool(step)) return false
  const { status } = step.tool
  if (status === "awaiting") return false
  if (level === "hideSuccessful") return status === "succeeded"
  return true
}

export function itemSteps(item: ActivityItem): ActivityStep[] {
  return item.type === "group" ? item.steps : [item.step]
}

const filtered = new WeakMap<
  ActivityModel,
  Map<ToolCallVisibility, ActivityModel>
>()

/**
 * The model with the steps `level` hides taken out — groups keep the members
 * left, and a group left empty goes. The summary stays the whole reply's.
 * Cached per model and level, so the rows below keep their props while the
 * reply re-renders.
 */
export function filterActivityModel(
  model: ActivityModel,
  level: ToolCallVisibility
): ActivityModel {
  if (level === "showAll") return model
  let byLevel = filtered.get(model)
  if (!byLevel) {
    byLevel = new Map()
    filtered.set(model, byLevel)
  }
  const cached = byLevel.get(level)
  if (cached) return cached
  const items: ActivityItem[] = []
  let changed = false
  for (const item of model.items) {
    if (item.type === "step") {
      if (stepHiddenBy(item.step, level)) changed = true
      else items.push(item)
      continue
    }
    const steps = item.steps.filter((step) => !stepHiddenBy(step, level))
    if (steps.length === item.steps.length) {
      items.push(item)
      continue
    }
    changed = true
    if (steps.length === 0) continue
    items.push({
      ...item,
      steps,
      status: combineStatuses(steps.map((step) => step.tool.status)),
    })
  }
  const result = changed ? subModel(model, items) : model
  byLevel.set(level, result)
  return result
}

/** A model of some of `model`'s items, answered by `answer` (none by default:
 *  the rows of a stretch of the reply are not followed by its answer). */
export function subModel(
  model: ActivityModel,
  items: ActivityItem[],
  answer: ActivityModel["answer"] = []
): ActivityModel {
  return {
    steps: items.flatMap(itemSteps),
    items,
    answer,
    summary: model.summary,
  }
}

function stepFailedUnrecovered(
  step: ActivityStep,
  recovered: ReadonlySet<string>
): boolean {
  return (
    step.type === "tool" &&
    isFailureStatus(step.tool.status) &&
    !recovered.has(step.key)
  )
}

/**
 * The rows that stay in view under a folded reply because something in them
 * failed and nothing later redid it — the group around such a step with only
 * the failed members left in it.
 */
export function unrecoveredItems(model: ActivityModel): ActivityItem[] {
  if (model.summary.unrecovered === 0) return []
  const recovered = model.summary.recoveredKeys
  const out: ActivityItem[] = []
  for (const item of model.items) {
    if (item.type === "step") {
      if (stepFailedUnrecovered(item.step, recovered)) out.push(item)
      continue
    }
    const steps = item.steps.filter((step) =>
      stepFailedUnrecovered(step, recovered)
    )
    if (steps.length === 0) continue
    out.push(
      steps.length === item.steps.length
        ? item
        : {
            ...item,
            key: steps[0]!.key,
            steps,
            status: combineStatuses(steps.map((step) => step.tool.status)),
          }
    )
  }
  return out
}

/** Rows waiting on the user (a permission request): they never fold away. */
export function awaitingItems(model: ActivityModel): ActivityItem[] {
  return model.items.filter((item) =>
    itemSteps(item).some(
      (step) => step.type === "tool" && step.tool.status === "awaiting"
    )
  )
}

function stepIsStandingException(step: ActivityStep): boolean {
  switch (step.type) {
    case "plan":
    case "image":
    case "image-job":
      return true
    case "note":
      return step.part.type === "proposed-plan"
    case "tool":
      return (
        step.tool.status === "awaiting" ||
        step.tool.kind === "question" ||
        step.tool.kind === "plan-mode" ||
        step.tool.kind === "feedback"
      )
    case "thought":
    case "delegation-polls":
    case "background-tasks":
    case "goal":
    case "tool-result":
      return false
    default: {
      const unhandled: never = step
      return unhandled
    }
  }
}

/**
 * Items that never disappear into a fold (besides work that outlives the turn,
 * which `ActivityParts pinnedOnly` handles): permission requests, user
 * questions, plans, generated images, and unrecovered failures.
 */
export function exceptionItems(model: ActivityModel): ActivityItem[] {
  const seen = new Set<string>()
  const out: ActivityItem[] = []
  for (const item of model.items) {
    if (itemSteps(item).some(stepIsStandingException)) {
      seen.add(item.key)
      out.push(item)
    }
  }
  for (const item of unrecoveredItems(model)) {
    if (seen.has(item.key)) continue
    seen.add(item.key)
    out.push(item)
  }
  return out
}

export interface EditTotals {
  files: number
  additions: number
  deletions: number
}

const NO_EDITS: EditTotals = { files: 0, additions: 0, deletions: 0 }

/** What the reply's edits add up to: distinct files, lines in and out. */
export function editTotals(model: ActivityModel): EditTotals {
  const paths = new Set<string>()
  let additions = 0
  let deletions = 0
  for (const step of model.steps) {
    if (step.type !== "tool" || step.tool.kind !== "edit") continue
    if (isFailureStatus(step.tool.status)) continue
    for (const file of step.tool.files ?? []) {
      paths.add(file.path)
      additions += file.additions ?? 0
      deletions += file.deletions ?? 0
    }
  }
  return paths.size === 0 && additions === 0 && deletions === 0
    ? NO_EDITS
    : { files: paths.size, additions, deletions }
}

/** A piece of a reply still being written: its prose, or a run of the steps
 *  between two pieces of prose. */
export type ReplySegment =
  | { kind: "prose"; key: string; item: ActivityItem }
  | { kind: "run"; key: string; items: ActivityItem[] }

function isProse(item: ActivityItem): boolean {
  return (
    item.type === "step" &&
    item.step.type === "note" &&
    item.step.part.type === "text"
  )
}

/** The reply as T3 Code shows one being written: its prose in place, the
 *  steps between two pieces of prose as one run. */
export function segmentItems(items: ActivityItem[]): ReplySegment[] {
  const out: ReplySegment[] = []
  let run: ActivityItem[] | null = null
  for (const item of items) {
    if (isProse(item)) {
      run = null
      out.push({ kind: "prose", key: item.key, item })
      continue
    }
    if (!run) {
      run = []
      out.push({ kind: "run", key: item.key, items: run })
    }
    run.push(item)
  }
  return out
}

/** What a run of steps did, for its folded line: the upstream header's
 *  counts over just those steps. */
export function summarizeItems(items: ActivityItem[]) {
  return summarizeActivity(items.flatMap(itemSteps))
}
