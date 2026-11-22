"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import { useTranslations } from "next-intl"
import { ChevronRightIcon } from "lucide-react"

import type { LiveMessage } from "@/contexts/acp-connections-context"
import { useTokenOutputSpeed } from "@/hooks/use-token-output-speed"
import { buildActivity, hasVisibleAnswer } from "@/lib/activity/build-activity"
import { disclosureKeysFor } from "@/lib/activity/group"
import type { ActivityItem, ActivityModel } from "@/lib/activity/types"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import {
  useChatViewPrefs,
  type ToolCallVisibility,
} from "@/lib/chat-view-prefs"
import { formatElapsedLabel } from "@/lib/format-elapsed"
import { cn } from "@/lib/utils"
import { ActivityParts, ContentPartsRenderer } from "../content-parts-renderer"
import { openDisclosures, useDisclosure } from "../activity/disclosure-store"
import { TurningRing } from "../activity/rail-icon"
import { useCompactThread, useFindTarget } from "./compact-thread"
import {
  editTotals,
  exceptionItems,
  filterActivityModel,
  itemSteps,
  segmentItems,
  subModel,
  summarizeItems,
  type EditTotals,
} from "./turn-model"

/** The fold of a reply outside the current round, by its parts (see
 *  upstream's `manualFold` in completed-turn-content.tsx): weak, so it goes
 *  with the reply, and kept through the virtual list unmounting the row. */
const manualFold = new WeakMap<AdaptedContentPart[], boolean>()

/** The steps whose call or thought holds `query`. */
function stepKeysHolding(
  model: ActivityModel,
  query: string,
  caseSensitive: boolean,
  block: string
): string[] {
  const needle = caseSensitive ? query : query.toLowerCase()
  const keys: string[] = []
  for (const step of model.steps) {
    if (block === "thinking") {
      if (step.type !== "thought") continue
      const haystack = step.part.content ?? ""
      if (
        (caseSensitive ? haystack : haystack.toLowerCase()).includes(needle)
      ) {
        keys.push(step.key)
      }
      continue
    }
    if (step.type !== "tool") continue
    const haystack = `${step.part.input ?? ""}\n${step.part.output ?? ""}\n${step.part.errorText ?? ""}`
    if ((caseSensitive ? haystack : haystack.toLowerCase()).includes(needle)) {
      keys.push(step.key)
    }
  }
  return keys
}

/**
 * keh4l build: a reply in the compact (T3 Code style) view.
 *
 * While the agent works: a "Working for 12s" line, the reply's prose as it is
 * written, each run of steps between two pieces of prose as one line saying
 * what it did, and the step under way as a row of its own (a thought shows
 * what is being thought). The working line opens every step.
 *
 * Once it is done everything before the answer folds into one "Worked for
 * 1m 12s" line — what the reply did, and a red count of failures nothing put
 * right; opening it shows the steps as flat rows. A failure nothing redid, a
 * permission request, and work that outlives the turn (delegations,
 * sub-agents, background tasks) stay in view folded. A reply with no answer
 * (stopped mid-call, a card that is its answer) does not fold.
 *
 * The rows are upstream's (`ActivityParts`), restyled flat by
 * `[data-chat-view="compact"]` in compact-view.css — the same detail panels,
 * groups and cards as the timeline view.
 */
export const CompactTurn = memo(function CompactTurn({
  parts,
  durationMs,
  completed,
  currentRound = false,
  turnIds,
  turnIndices,
}: {
  parts: AdaptedContentPart[]
  durationMs?: number | null
  completed: boolean
  currentRound?: boolean
  /** The transcript turns this reply is drawn from (the find bar names
   *  turns). */
  turnIds?: readonly string[]
  /** Global turn indices covered by this reply (primary key when in-flight
   *  ids differ from the parser's `turn-N` ids). */
  turnIndices?: readonly number[]
}) {
  const prefs = useChatViewPrefs()
  const thread = useCompactThread()
  const find = useFindTarget()
  const isStreaming = !completed
  const activity = useMemo(
    () => buildActivity(parts, { isStreaming }),
    [parts, isStreaming]
  )

  const targeted =
    find !== null &&
    ((turnIndices ?? []).includes(find.turnIndex) ||
      (turnIds ?? []).some((id) => find.turnIds.has(id)))

  // --- fold -----------------------------------------------------------------
  const [localOpen, setLocalOpen] = useState(
    () => manualFold.get(parts) ?? false
  )
  const [wasCurrent, setWasCurrent] = useState(currentRound)
  if (wasCurrent !== currentRound) {
    setWasCurrent(currentRound)
    // The round moved on without a send (a background turn): keep what the
    // reader had made of this one.
    if (wasCurrent) setLocalOpen(thread.round.open)
  }
  const chosenOpen = currentRound ? thread.round.open : localOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (currentRound) {
        thread.round.setOpen(next)
        return
      }
      manualFold.set(parts, next)
      setLocalOpen(next)
    },
    [currentRound, thread.round, parts]
  )
  const open = chosenOpen || targeted

  // --- what is shown ----------------------------------------------------------
  const level: ToolCallVisibility = targeted ? "showAll" : prefs.toolVisibility
  const zen = level === "zen"
  const visible = filterActivityModel(activity, zen ? "hideAll" : level)
  const hasSteps = activity.items.length > 0
  const answerVisible = hasVisibleAnswer(activity.answer)
  const foldable = hasSteps && answerVisible
  const totals = useMemo(() => editTotals(activity), [activity])

  // The find bar's match is in a row's call or thought: open that row (and its group).
  const findToken = targeted ? find.token : null
  useEffect(() => {
    if (findToken === null || !find) return
    if (
      find.block !== "tool_input" &&
      find.block !== "tool_output" &&
      find.block !== "thinking"
    ) {
      return
    }
    const keys = stepKeysHolding(
      activity,
      find.query,
      find.caseSensitive,
      find.block
    )
    if (keys.length === 0) return
    openDisclosures(
      keys.flatMap((key) => disclosureKeysFor(activity.items, key))
    )
    // Only when the bar moves, not on every batch of a streaming reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findToken])

  // The fold line's red failure count: open the reply at the first failure
  // nothing redid (as upstream's header link does).
  const rootRef = useRef<HTMLDivElement | null>(null)
  const revealRef = useRef<((stepKey: string) => boolean) | null>(null)
  const failureKey = activity.summary.firstUnrecoveredKey
  const jumpToFailure = useCallback(() => {
    if (!failureKey) return
    openDisclosures(disclosureKeysFor(activity.items, failureKey))
    if (!chosenOpen) setOpen(true)
    requestAnimationFrame(() => {
      revealRef.current?.(failureKey)
      requestAnimationFrame(() => {
        const root = rootRef.current
        if (!root) return
        const escaped = CSS.escape(failureKey)
        const rows = root.querySelectorAll(`[data-step-key="${escaped}"]`)
        const row =
          rows[rows.length - 1] ??
          root.querySelector(`[data-step-key^="${escaped}:"]`)
        row?.scrollIntoView({ block: "center", behavior: "smooth" })
      })
    })
  }, [activity, failureKey, chosenOpen, setOpen])

  // Parsers leave empty placeholder turns between tool exchanges (see
  // upstream): nothing to head.
  if (completed && !hasSteps && !answerVisible) {
    return (
      <ContentPartsRenderer
        parts={parts}
        role="assistant"
        isStreaming={false}
      />
    )
  }

  const answer = answerVisible ? (
    <div data-compact-answer="">
      <ContentPartsRenderer
        parts={activity.answer}
        role="assistant"
        isStreaming={isStreaming}
      />
    </div>
  ) : null

  let body: ReactNode
  if (isStreaming) {
    body = (
      <>
        <WorkingLine
          liveMessage={currentRound ? thread.liveMessage : null}
          totals={totals}
          showSpeed={prefs.liveSpeed}
          open={open}
          onToggle={zen ? undefined : () => setOpen(!chosenOpen)}
        />
        {zen ? (
          <ZenPreview model={activity} />
        ) : open ? (
          <LiveExpandedList
            model={visible}
            revealRef={revealRef}
            stepCount={visible.steps.length}
          />
        ) : (
          <LiveSegments
            model={activity}
            visible={visible}
            answerFollows={answerVisible}
          />
        )}
        {zen ? <Exceptions model={activity} isStreaming /> : null}
      </>
    )
  } else if (!hasSteps) {
    body = null
  } else if (zen && foldable) {
    body = <Exceptions model={activity} isStreaming={false} />
  } else {
    const shown = open || !foldable
    body = (
      <>
        <FoldLine
          durationMs={durationMs}
          summary={activity.summary}
          totals={totals}
          open={shown}
          onToggle={foldable ? () => setOpen(!chosenOpen) : undefined}
          onJumpToFailure={failureKey ? jumpToFailure : undefined}
        />
        {shown ? (
          <ActivityParts
            model={visible}
            isStreaming={false}
            revealRef={revealRef}
          />
        ) : (
          <Exceptions model={activity} isStreaming={false} />
        )}
      </>
    )
  }

  return (
    <div
      ref={rootRef}
      className="compact-turn flex flex-col gap-2"
      data-compact-turn=""
      data-reply-current={isStreaming || currentRound ? "" : undefined}
    >
      {body}
      {answer}
    </div>
  )
})

/** Scrollable expanded step list while the turn is streaming (capped at
 *  min(18rem, 50dvh)), following the latest step while resting at the bottom. */
function LiveExpandedList({
  model,
  revealRef,
  stepCount,
}: {
  model: ActivityModel
  revealRef: RefObject<((stepKey: string) => boolean) | null>
  stepCount: number
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [stepCount])
  return (
    <div
      ref={scrollRef}
      className="compact-live-scroll"
      data-compact-live-scroll=""
      onScroll={(event) => {
        const el = event.currentTarget
        stickRef.current =
          el.scrollTop + el.clientHeight >= el.scrollHeight - 24
      }}
    >
      <ActivityParts model={model} isStreaming revealRef={revealRef} />
    </div>
  )
}

/** What stays in view under a folded reply: work that outlives the turn,
 *  requests waiting on the user, questions, plans, generated images, and
 *  failures nothing redid. */
function Exceptions({
  model,
  isStreaming,
  excludeKeys,
}: {
  model: ActivityModel
  isStreaming: boolean
  excludeKeys?: ReadonlySet<string>
}) {
  const kept = useMemo(() => {
    const items = exceptionItems(model).filter(
      (item) => !excludeKeys?.has(item.key)
    )
    return items.length > 0 ? subModel(model, items, model.answer) : null
  }, [model, excludeKeys])
  const pinnedModel = useMemo(() => {
    if (!excludeKeys || excludeKeys.size === 0) return model
    const items = model.items.filter((item) => !excludeKeys.has(item.key))
    return items.length === model.items.length ? model : subModel(model, items)
  }, [model, excludeKeys])
  return (
    <>
      <ActivityParts model={pinnedModel} isStreaming={isStreaming} pinnedOnly />
      {kept ? <ActivityParts model={kept} isStreaming={isStreaming} /> : null}
    </>
  )
}

/**
 * The reply as it is written: its prose, a line per run of steps between two
 * pieces of prose, and the step under way. A run's line opens its rows.
 * Standing exceptions (permission requests, questions, plans, running
 * sub-agents, images) stay visible outside folded runs.
 */
function LiveSegments({
  model,
  visible,
  answerFollows,
}: {
  model: ActivityModel
  visible: ActivityModel
  /** Words after the last step: the run before them is done. */
  answerFollows: boolean
}) {
  const segments = useMemo(() => segmentItems(visible.items), [visible])
  const liveItemKey = useMemo(() => {
    if (answerFollows || segments.length === 0) return null
    const last = segments[segments.length - 1]!
    if (last.kind !== "run" || last.items.length === 0) return null
    return last.items[last.items.length - 1]!.key
  }, [segments, answerFollows])
  const excludeKeys = useMemo(
    () => (liveItemKey ? new Set([liveItemKey]) : undefined),
    [liveItemKey]
  )
  return (
    <>
      {segments.map((segment, index) => {
        const last = index === segments.length - 1
        if (segment.kind === "prose") {
          return (
            <ActivityParts
              key={segment.key}
              model={subModel(model, [segment.item])}
              isStreaming
            />
          )
        }
        if (last && !answerFollows) {
          return (
            <LiveStep key={segment.key} model={model} run={segment.items} />
          )
        }
        return <RunLine key={segment.key} model={model} items={segment.items} />
      })}
      <Exceptions model={model} isStreaming excludeKeys={excludeKeys} />
    </>
  )
}

/** The step under way, on its own; a thought shows what is being thought. */
function LiveStep({
  model,
  run,
}: {
  model: ActivityModel
  run: ActivityItem[]
}) {
  const item = run[run.length - 1]!
  const sub = useMemo(() => subModel(model, [item]), [model, item])
  const thought =
    item.type === "step" && item.step.type === "thought" && item.step.streaming
      ? item.step.part.content.trim()
      : ""
  return (
    <div data-compact-live-step="">
      <ActivityParts model={sub} isStreaming />
      {thought ? (
        <p className="compact-thought-preview" data-compact-thought="">
          {thought}
        </p>
      ) : null}
    </div>
  )
}

/** A finished run of steps as one line — `Read 3 files · 2 commands` — that
 *  opens its rows. */
function RunLine({
  model,
  items,
}: {
  model: ActivityModel
  items: ActivityItem[]
}) {
  const t = useTranslations("CompactView")
  const tActivity = useTranslations("Folder.chat.activity")
  const [open, setOpen] = useDisclosure(`compact-run:${items[0]!.key}`, {
    defaultOpen: false,
  })
  const summary = useMemo(() => summarizeItems(items), [items])
  const sub = useMemo(() => subModel(model, items), [model, items])
  const label = useMemo(() => {
    const pieces = summaryPieces(summary.counts, tActivity)
    if (pieces.length > 0) return pieces.join(tActivity("header.separator"))
    const steps = items.flatMap(itemSteps).length
    return steps === 1 &&
      items[0]!.type === "step" &&
      items[0]!.step.type === "thought"
      ? tActivity("row.thought")
      : tActivity("header.steps", { count: steps })
  }, [summary, items, tActivity])
  return (
    <div data-compact-run="">
      <button
        type="button"
        className="compact-line group/line"
        aria-expanded={open}
        aria-label={open ? t("collapseSteps") : t("expandSteps")}
        onClick={() => setOpen(!open)}
      >
        <ChevronRightIcon aria-hidden="true" className="compact-chevron" />
        <span className="min-w-0 truncate">{label}</span>
        {summary.unrecovered > 0 ? (
          <span className="shrink-0 text-tone-danger">
            {tActivity("header.failed", { count: summary.unrecovered })}
          </span>
        ) : null}
      </button>
      {open ? <ActivityParts model={sub} isStreaming={false} /> : null}
    </div>
  )
}

const CATEGORY_ORDER = [
  "commands",
  "editedFiles",
  "agents",
  "mcp",
  "web",
  "readFiles",
  "searches",
] as const

const CATEGORY_KEY = {
  commands: "header.commands",
  editedFiles: "header.edits",
  agents: "header.agents",
  mcp: "header.mcp",
  web: "header.web",
  readFiles: "header.reads",
  searches: "header.searches",
} as const

type CountTranslator = (
  key: (typeof CATEGORY_KEY)[keyof typeof CATEGORY_KEY],
  values: { count: number }
) => string

/** The upstream header's breakdown by kind, most telling first, at most
 *  three. */
function summaryPieces(
  counts: ActivityModel["summary"]["counts"],
  t: CountTranslator
): string[] {
  return CATEGORY_ORDER.filter((key) => counts[key] > 0)
    .slice(0, 3)
    .map((key) => t(CATEGORY_KEY[key], { count: counts[key] }))
}

/** Zen: the step under way as a line of words, nothing to open. */
function ZenPreview({ model }: { model: ActivityModel }) {
  const last = model.steps[model.steps.length - 1]
  const text =
    last?.type === "thought" ? last.part.content.trim().split("\n")[0] : ""
  if (!text) return null
  return <p className="compact-zen-preview">{text}</p>
}

/** `+12 −3` in the tones of a diff. */
function DiffFigures({ totals }: { totals: EditTotals }) {
  if (totals.additions === 0 && totals.deletions === 0) return null
  return (
    <span className="inline-flex shrink-0 gap-1 tabular-nums">
      <span className="text-tone-success">+{totals.additions}</span>
      <span className="text-tone-danger">−{totals.deletions}</span>
    </span>
  )
}

/** "Working for 12s" while the agent works, with what it has changed so far
 *  (and its speed, when the setting asks for it). Opens every step. */
function WorkingLine({
  liveMessage,
  totals,
  showSpeed,
  open,
  onToggle,
}: {
  liveMessage: LiveMessage | null
  totals: EditTotals
  showSpeed: boolean
  open: boolean
  onToggle?: () => void
}) {
  const t = useTranslations("CompactView")
  const tElapsed = useTranslations("Folder.chat.liveTurnStats")
  const [mountedAt] = useState(() => Date.now())
  const startedAt = liveMessage?.startedAt ?? mountedAt
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = formatElapsedLabel(now - startedAt, tElapsed)
  const content = (
    <>
      <TurningRing className="compact-working-ring" />
      <span className="shrink-0">{t("working")}</span>
      <span className="shrink-0 tabular-nums text-foreground">{elapsed}</span>
      <span className="compact-line-meta">
        <DiffFigures totals={totals} />
        {showSpeed && liveMessage ? <LiveSpeed message={liveMessage} /> : null}
      </span>
      {onToggle ? (
        <ChevronRightIcon aria-hidden="true" className="compact-chevron" />
      ) : null}
    </>
  )
  return onToggle ? (
    <button
      type="button"
      className="compact-line"
      data-compact-working=""
      aria-expanded={open}
      aria-label={open ? t("collapseSteps") : t("expandSteps")}
      onClick={onToggle}
    >
      {content}
    </button>
  ) : (
    <div className="compact-line" data-compact-working="">
      {content}
    </div>
  )
}

function LiveSpeed({ message }: { message: LiveMessage }) {
  const tps = useTokenOutputSpeed(message)
  if (tps == null) return null
  return <span className="shrink-0 tabular-nums">{tps.toFixed(1)} tok/s</span>
}

/** "Worked for 1m 12s", what the reply did, and its failures — the line a
 *  finished reply folds into. */
function FoldLine({
  durationMs,
  summary,
  totals,
  open,
  onToggle,
  onJumpToFailure,
}: {
  durationMs?: number | null
  summary: ActivityModel["summary"]
  totals: EditTotals
  open: boolean
  onToggle?: () => void
  onJumpToFailure?: () => void
}) {
  const t = useTranslations("CompactView")
  const tActivity = useTranslations("Folder.chat.activity")
  const tElapsed = useTranslations("Folder.chat.liveTurnStats")
  const label =
    typeof durationMs === "number" && durationMs > 0
      ? t("workedFor", { time: formatElapsedLabel(durationMs, tElapsed) })
      : t("worked")
  const meta = (
    <span className="compact-line-meta">
      {summary.unrecovered > 0 ? (
        onJumpToFailure ? (
          <span
            role="button"
            tabIndex={0}
            className="shrink-0 text-tone-danger underline-offset-2 hover:underline"
            title={tActivity("header.jumpToFailure")}
            onClick={(event) => {
              event.stopPropagation()
              onJumpToFailure()
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              event.stopPropagation()
              onJumpToFailure()
            }}
          >
            {tActivity("header.failed", { count: summary.unrecovered })}
          </span>
        ) : (
          <span className="shrink-0 text-tone-danger">
            {tActivity("header.failed", { count: summary.unrecovered })}
          </span>
        )
      ) : null}
      {summary.steps > 0 ? (
        <span className="shrink-0">
          {tActivity("header.steps", { count: summary.steps })}
        </span>
      ) : null}
      {totals.files > 0 ? (
        <span className="shrink-0">{t("files", { count: totals.files })}</span>
      ) : null}
      <DiffFigures totals={totals} />
    </span>
  )
  const content = (
    <>
      <span className="min-w-0 truncate">{label}</span>
      {meta}
      {onToggle ? (
        <ChevronRightIcon aria-hidden="true" className="compact-chevron" />
      ) : null}
    </>
  )
  return onToggle ? (
    <button
      type="button"
      className={cn("compact-line compact-fold-line")}
      data-compact-fold=""
      aria-expanded={open}
      aria-label={open ? t("collapseSteps") : t("expandSteps")}
      onClick={onToggle}
    >
      {content}
    </button>
  ) : (
    <div className="compact-line compact-fold-line" data-compact-fold="">
      {content}
    </div>
  )
}
