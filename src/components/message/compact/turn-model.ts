/**
 * keh4l build: what the compact (T3 Code style) view makes of a reply's
 * activity model — which steps a tool-call visibility level leaves, which
 * failures stay in view when the reply folds, how much the reply edited, and
 * how a reply still being written splits into prose and runs of steps.
 *
 * Pure functions over the upstream `ActivityModel` (`buildActivity`), so the
 * compact view never parses a reply on its own.
 */

import {
  combineStatuses,
  isFailureStatus,
  isLiveStatus,
} from "@/lib/activity/status"
import { summarizeActivity } from "@/lib/activity/summarize"
import type {
  ActivityCounts,
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

/**
 * Work that goes on after the reply: sub-agents, delegations and background
 * tasks. Mirrors `canOutliveTurn` in activity/activity-timeline.tsx (what
 * `ActivityParts pinnedOnly` keeps).
 */
export function itemOutlivesTurn(item: ActivityItem): boolean {
  if (item.type !== "step") return false
  const { step } = item
  if (step.type === "background-tasks" || step.type === "delegation-polls") {
    return true
  }
  return (
    step.type === "tool" &&
    (step.tool.kind === "delegation" ||
      step.tool.kind === "delegation-resume" ||
      step.tool.kind === "delegation-status" ||
      step.tool.kind === "agent")
  )
}

/** A row that is never folded into a group's summary line: a request waiting
 *  on the user, a question, a plan, an image, or work that outlives the
 *  turn. (T3 Code keeps approvals, questions and to-do lists out of tool
 *  groups the same way.) */
export function itemStandsAlone(item: ActivityItem): boolean {
  return itemOutlivesTurn(item) || itemSteps(item).some(stepIsStandingException)
}

/** A piece of a reply as the compact view lays it out: the agent's prose in
 *  place, a row standing on its own, or a group — the steps between two of
 *  those — drawn as one summary line. */
export type ReplyBlock =
  | { kind: "prose"; key: string; item: ActivityItem }
  | { kind: "single"; key: string; item: ActivityItem }
  | { kind: "group"; key: string; items: ActivityItem[] }

function isProse(item: ActivityItem): boolean {
  return (
    item.type === "step" &&
    item.step.type === "note" &&
    item.step.part.type === "text"
  )
}

export function replyBlocks(items: ActivityItem[]): ReplyBlock[] {
  const out: ReplyBlock[] = []
  let group: ActivityItem[] | null = null
  for (const item of items) {
    if (isProse(item) || itemStandsAlone(item)) {
      group = null
      out.push({
        kind: isProse(item) ? "prose" : "single",
        key: item.key,
        item,
      })
      continue
    }
    if (!group) {
      group = []
      out.push({ kind: "group", key: item.key, items: group })
    }
    group.push(item)
  }
  return out
}

/** The disclosure-store key of a group's step list. */
export function groupDisclosureKey(items: readonly ActivityItem[]): string {
  return `compact-run:${items[0]?.key ?? ""}`
}

/** Whether `stepKey` is one of the group's steps (or a group item itself). */
export function groupHolds(
  items: readonly ActivityItem[],
  stepKey: string
): boolean {
  return items.some(
    (item) =>
      item.key === stepKey ||
      itemSteps(item).some((step) => step.key === stepKey)
  )
}

/** The step a group is on: its last one. */
export function groupLastStep(
  items: readonly ActivityItem[]
): ActivityStep | null {
  const last = items[items.length - 1]
  if (!last) return null
  const steps = itemSteps(last)
  return steps[steps.length - 1] ?? null
}

/** Still under way: a call not settled yet, or a thought being written. */
export function stepIsLive(step: ActivityStep): boolean {
  switch (step.type) {
    case "tool":
      return isLiveStatus(step.tool.status)
    case "thought":
      return step.streaming
    default:
      return false
  }
}

/** The kinds a group's summary line names, in the order it prefers them:
 *  what changed the workspace first (T3 Code ranks commands and edits ahead
 *  of looking around). */
export type GroupCategory = keyof ActivityCounts
const GROUP_CATEGORIES: readonly GroupCategory[] = [
  "commands",
  "editedFiles",
  "agents",
  "mcp",
  "web",
  "readFiles",
  "searches",
]
const FIRST_RANK: ReadonlySet<GroupCategory> = new Set([
  "commands",
  "editedFiles",
])

/** Which count a step adds to (`summarizeActivity`'s), "other" for a step
 *  the counts leave out, null for bookkeeping that is no step of its own. */
function stepCategory(
  step: ActivityStep
): GroupCategory | "other" | "thought" | null {
  switch (step.type) {
    case "thought":
      return "thought"
    case "tool":
      break
    case "goal":
    case "tool-result":
      return "other"
    case "note":
    case "plan":
    case "image":
    case "image-job":
    case "delegation-polls":
    case "background-tasks":
      return null
    default: {
      const unhandled: never = step
      return unhandled
    }
  }
  const kind: ToolStepKind = step.tool.kind
  switch (kind) {
    case "command":
    case "script":
      return "commands"
    case "edit":
      return "editedFiles"
    case "agent":
    case "collab-agent":
    case "delegation":
    case "delegation-resume":
      return "agents"
    case "mcp":
      return "mcp"
    case "fetch":
    case "web-search":
      return "web"
    case "read":
      return "readFiles"
    case "search":
    case "glob":
    case "list":
      return "searches"
    case "compaction":
    case "todo":
    case "delegation-status":
    case "shell-session":
      return null
    case "delegation-cancel":
    case "memory":
    case "monitor":
    case "network":
    case "skill":
    case "goal":
    case "plan-mode":
    case "question":
    case "feedback":
    case "workbench":
    case "completion":
    case "generic":
      return "other"
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

export interface GroupSummaryPiece {
  category: GroupCategory | "other" | "thought"
  count: number
}

export interface GroupSummary {
  /** At most two kinds by name, then how many other steps (T3 Code's
   *  `summarizeToolGroup`): `Read 2 files, searched once`. Only thoughts:
   *  one "thought" piece. */
  pieces: GroupSummaryPiece[]
  /** A step in it failed and nothing later in the reply redid it. */
  failed: boolean
}

export function summarizeGroup(
  items: readonly ActivityItem[],
  recoveredKeys: ReadonlySet<string>
): GroupSummary {
  const steps = items.flatMap(itemSteps)
  const counts = summarizeActivity(steps).counts
  const firstSeen = new Map<GroupCategory, number>()
  const stepsIn = new Map<GroupCategory | "other", number>()
  let thoughts = 0
  steps.forEach((step, index) => {
    const category = stepCategory(step)
    if (category === null) return
    if (category === "thought") {
      thoughts += 1
      return
    }
    stepsIn.set(category, (stepsIn.get(category) ?? 0) + 1)
    if (category !== "other" && !firstSeen.has(category)) {
      firstSeen.set(category, index)
    }
  })
  const present = GROUP_CATEGORIES.filter((c) => counts[c] > 0).sort(
    (a, b) =>
      Number(!FIRST_RANK.has(a)) - Number(!FIRST_RANK.has(b)) ||
      (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0)
  )
  const named = present.slice(0, 2)
  const pieces: GroupSummaryPiece[] = named.map((category) => ({
    category,
    count: counts[category],
  }))
  let others = stepsIn.get("other") ?? 0
  for (const category of present.slice(2)) others += stepsIn.get(category) ?? 0
  if (others > 0) pieces.push({ category: "other", count: others })
  if (pieces.length === 0 && thoughts > 0) {
    pieces.push({ category: "thought", count: thoughts })
  }
  const failed = steps.some(
    (step) =>
      step.type === "tool" &&
      isFailureStatus(step.tool.status) &&
      !recoveredKeys.has(step.key)
  )
  return { pieces, failed }
}
