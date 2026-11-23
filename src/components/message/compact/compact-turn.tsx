"use client"

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useTranslations } from "next-intl"
import {
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  PlugIcon,
  SearchIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react"

import type { LiveMessage } from "@/contexts/acp-connections-context"
import { useTokenOutputSpeed } from "@/hooks/use-token-output-speed"
import { buildActivity, hasVisibleAnswer } from "@/lib/activity/build-activity"
import { disclosureKeysFor } from "@/lib/activity/group"
import type {
  ActivityItem,
  ActivityModel,
  ActivityStep,
  ToolStepKind,
} from "@/lib/activity/types"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import {
  useChatViewPrefs,
  type ToolCallVisibility,
} from "@/lib/chat-view-prefs"
import { formatElapsedLabel } from "@/lib/format-elapsed"
import { cn } from "@/lib/utils"
import { ActivityParts, ContentPartsRenderer } from "../content-parts-renderer"
import { openDisclosures, useDisclosure } from "../activity/disclosure-store"
import type { ActivityIcon } from "../activity/rail-icon"
import {
  GOAL_ICON,
  GROUP_ICON,
  IMAGE_ICON,
  PLAN_ICON,
  THOUGHT_ICON,
  toolIcon,
} from "../activity/step-visuals"
import {
  useCompactThread,
  useFindTarget,
  useHoldInPlace,
} from "./compact-thread"
import {
  awaitingItems,
  exceptionItems,
  filterActivityModel,
  groupDisclosureKey,
  groupHolds,
  groupLastStep,
  itemSteps,
  replyBlocks,
  stepIsLive,
  subModel,
  summarizeGroup,
  type GroupSummaryPiece,
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
 * keh4l build: a reply in the compact view, laid out as T3 Code does
 * (`MessagesTimeline` / `TimelineWorkGroupRows`).
 *
 * While the agent works: a "Working for 12s" line under a hairline, then the
 * reply as it is written — its prose in place, each group of steps between two
 * pieces of prose drawn as one line saying what it did ("Read 2 files,
 * searched once"), and the step under way as a line of its own with a light
 * running across it (a thought shows what is being thought above it). Opening
 * a group's line — or the live one — lists its steps in a short box of their
 * own that scrolls, the live box following its newest step.
 *
 * Once it is done the same line becomes "Worked for 12s ›" and everything
 * before the answer folds under it; opening it shows those group lines again,
 * not every step. A failure nothing redid, a permission request, and work that
 * outlives the turn (delegations, sub-agents, background tasks) stay in view
 * folded; requests, questions, plans and images never go into a group. A
 * reply with no answer (stopped mid-call, a card that is its answer) does not
 * fold. Opening or closing anything keeps the line clicked where it is
 * (`useHoldInPlace`).
 *
 * The step rows are upstream's (`ActivityParts`), restyled flat by
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
  // A group opened while the reply is written: the reader is in it, so the
  // reply does not fold away under them when it is done.
  const onGroupOpened = useCallback(() => {
    if (isStreaming) setOpen(true)
  }, [isStreaming, setOpen])

  // --- what is shown ----------------------------------------------------------
  const level: ToolCallVisibility = targeted ? "showAll" : prefs.toolVisibility
  const zen = level === "zen"
  const visible = filterActivityModel(activity, zen ? "hideAll" : level)
  const hasSteps = activity.items.length > 0
  const answerVisible = hasVisibleAnswer(activity.answer)
  const foldable = hasSteps && answerVisible

  // The find bar's match is in a row's call or thought: open that row and the
  // group holding it.
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
    const groups = replyBlocks(activity.items).flatMap((block) =>
      block.kind === "group" && keys.some((key) => groupHolds(block.items, key))
        ? [groupDisclosureKey(block.items)]
        : []
    )
    openDisclosures([
      ...groups,
      ...keys.flatMap((key) => disclosureKeysFor(activity.items, key)),
    ])
    // Only when the bar moves, not on every batch of a streaming reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findToken])

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
          showSpeed={prefs.liveSpeed}
        />
        {zen ? (
          <>
            <ZenPreview model={activity} />
            <Exceptions model={activity} isStreaming />
          </>
        ) : (
          <ReplyBlocks
            model={activity}
            visible={visible}
            live
            answerFollows={answerVisible}
            onGroupOpened={onGroupOpened}
          />
        )}
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
          open={shown}
          onToggle={foldable ? () => setOpen(!chosenOpen) : undefined}
        />
        {shown ? (
          <ReplyBlocks
            model={activity}
            visible={visible}
            live={false}
            answerFollows
          />
        ) : (
          <Exceptions model={activity} isStreaming={false} />
        )}
      </>
    )
  }

  return (
    <div
      className="compact-turn flex flex-col gap-2"
      data-compact-turn=""
      data-reply-current={isStreaming || currentRound ? "" : undefined}
    >
      {body}
      {answer}
    </div>
  )
})

/** What stays in view under a folded reply: work that outlives the turn,
 *  requests waiting on the user, questions, plans, generated images, and
 *  failures nothing redid. */
function Exceptions({
  model,
  isStreaming,
}: {
  model: ActivityModel
  isStreaming: boolean
}) {
  const kept = useMemo(() => {
    const items = exceptionItems(model)
    return items.length > 0 ? subModel(model, items, model.answer) : null
  }, [model])
  return (
    <>
      <ActivityParts model={model} isStreaming={isStreaming} pinnedOnly />
      {kept ? <ActivityParts model={kept} isStreaming={isStreaming} /> : null}
    </>
  )
}

/**
 * The reply's steps as T3 Code lays them out: prose in place, rows that stand
 * alone, a summary line per group — the live one for the step under way —
 * and, while the agent works with nothing under way and nothing to wait for,
 * a "Thinking" line.
 */
function ReplyBlocks({
  model,
  visible,
  live,
  answerFollows,
  onGroupOpened,
}: {
  model: ActivityModel
  visible: ActivityModel
  live: boolean
  /** Words after the last step: the agent is writing its answer. */
  answerFollows: boolean
  onGroupOpened?: () => void
}) {
  const blocks = useMemo(() => replyBlocks(visible.items), [visible])
  const last = blocks[blocks.length - 1]
  const lastStep = last?.kind === "group" ? groupLastStep(last.items) : null
  const working = live && !answerFollows
  const liveKey =
    working && last?.kind === "group" && lastStep && stepIsLive(lastStep)
      ? last.key
      : null
  const thinking =
    working && liveKey === null && awaitingItems(model).length === 0
  return (
    <div className="compact-blocks" data-compact-blocks="">
      {blocks.map((block) => {
        if (block.kind !== "group") {
          return (
            <ActivityParts
              key={block.key}
              model={subModel(model, [block.item])}
              isStreaming={live}
            />
          )
        }
        return block.key === liveKey ? (
          <LiveGroup
            key={block.key}
            model={model}
            items={block.items}
            onOpened={onGroupOpened}
          />
        ) : (
          <GroupBlock
            key={block.key}
            model={model}
            items={block.items}
            live={live}
            onOpened={onGroupOpened}
          />
        )
      })}
      {thinking ? <ThinkingLine /> : null}
    </div>
  )
}

/** A finished group: its single step as that step's own row, more steps as a
 *  summary line that opens them. */
function GroupBlock(props: {
  model: ActivityModel
  items: ActivityItem[]
  live: boolean
  onOpened?: () => void
}) {
  const { model, items, live } = props
  if (items.length === 1 && itemSteps(items[0]!).length === 1) {
    return <ActivityParts model={subModel(model, items)} isStreaming={live} />
  }
  return <SummarizedGroup {...props} />
}

function SummarizedGroup({
  model,
  items,
  live,
  onOpened,
}: {
  model: ActivityModel
  items: ActivityItem[]
  live: boolean
  onOpened?: () => void
}) {
  const tActivity = useTranslations("Folder.chat.activity")
  const [open, setOpen] = useDisclosure(groupDisclosureKey(items), {
    defaultOpen: false,
  })
  const hold = useHoldInPlace()
  const summary = useMemo(
    () => summarizeGroup(items, model.summary.recoveredKeys),
    [items, model.summary.recoveredKeys]
  )
  const label = useGroupLabel(summary.pieces, items)
  return (
    <div data-compact-group="">
      <button
        type="button"
        className="compact-row"
        data-compact-group-row=""
        data-failed={summary.failed ? "" : undefined}
        aria-expanded={open}
        onClick={(event) => {
          const next = !open
          hold(event.currentTarget, () => setOpen(next))
          if (next) onOpened?.()
        }}
      >
        <PieceIcon
          category={summary.pieces[0]?.category}
          className={cn(
            "compact-row-icon",
            summary.failed && "text-tone-danger"
          )}
        />
        <span className="compact-row-label">{label}</span>
        {summary.failed ? (
          <>
            <XIcon aria-hidden="true" className="compact-row-fail" />
            <span className="sr-only">
              {tActivity("row.listJoiner")}
              {tActivity("header.failed", { count: 1 })}
            </span>
          </>
        ) : null}
      </button>
      {open ? (
        <GroupList follow={false}>
          <ActivityParts model={subModel(model, items)} isStreaming={live} />
        </GroupList>
      ) : null}
    </div>
  )
}

/** The group the agent is in: what it is doing now, with a light running
 *  across it; opening it lists the group's steps so far. */
function LiveGroup({
  model,
  items,
  onOpened,
}: {
  model: ActivityModel
  items: ActivityItem[]
  onOpened?: () => void
}) {
  const [open, setOpen] = useDisclosure(groupDisclosureKey(items), {
    defaultOpen: false,
  })
  const hold = useHoldInPlace()
  const step = groupLastStep(items)
  const line = useStepLine(step)
  const thought =
    step?.type === "thought" && step.streaming
      ? (step.part.content ?? "").trim()
      : ""
  const Icon = line.icon
  return (
    <div data-compact-group="" data-compact-live-group="">
      {thought && !open ? (
        <div
          className="compact-row compact-thought-row"
          data-compact-thought=""
        >
          <THOUGHT_ICON aria-hidden="true" className="compact-row-icon" />
          <p className="compact-thought-preview">{thought}</p>
        </div>
      ) : null}
      <button
        type="button"
        className="compact-row"
        data-compact-live-row=""
        aria-expanded={open}
        onClick={(event) => {
          const next = !open
          hold(event.currentTarget, () => setOpen(next))
          if (next) onOpened?.()
        }}
      >
        <Icon aria-hidden="true" className="compact-row-icon" />
        <span className="compact-row-label compact-shine">{line.label}</span>
      </button>
      {open ? (
        <GroupList follow>
          <ActivityParts model={subModel(model, items)} isStreaming />
        </GroupList>
      ) : null}
    </div>
  )
}

/** The agent at work with no step under way: T3 Code's "Thinking" line. */
function ThinkingLine() {
  const t = useTranslations("Folder.chat.activity")
  return (
    <div className="compact-row" data-compact-thinking="">
      <THOUGHT_ICON aria-hidden="true" className="compact-row-icon" />
      <span className="compact-row-label compact-shine">
        {t("row.thinking")}
      </span>
    </div>
  )
}

/**
 * A group's steps in a box of their own, at most `min(18rem, 50dvh)` tall
 * (unbounded while a step in it is open, as T3 Code grows its box by the
 * opened rows), fading out at an edge with more beyond it. A live box rests
 * at its end and follows the steps that join there until the reader scrolls
 * up in it.
 */
function GroupList({
  follow,
  children,
}: {
  follow: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const atEndRef = useRef(true)
  const [fade, setFade] = useState({ top: false, bottom: false })
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setFade((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom }
    )
  }, [])
  // The observer reports the first size as soon as it observes, so the
  // first settle needs no call of its own.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (follow && atEndRef.current) el.scrollTop = el.scrollHeight
      measure()
    })
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [follow, measure])
  return (
    <div
      ref={ref}
      className="compact-group-list"
      data-compact-group-list=""
      data-fade-top={fade.top ? "" : undefined}
      data-fade-bottom={fade.bottom ? "" : undefined}
      onScroll={(event) => {
        const el = event.currentTarget
        atEndRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
        measure()
      }}
    >
      <div>{children}</div>
    </div>
  )
}

const PIECE_KEY = {
  commands: "groupCommands",
  editedFiles: "groupEditedFiles",
  agents: "groupAgents",
  mcp: "groupMcp",
  web: "groupWeb",
  readFiles: "groupReadFiles",
  searches: "groupSearches",
  thought: "groupThoughts",
  other: "groupOther",
} as const satisfies Record<GroupSummaryPiece["category"], string>

/** `Read 2 files, searched once`: the pieces in the reader's language,
 *  joined as the activity rows join a list, the first letter raised. */
function useGroupLabel(
  pieces: GroupSummaryPiece[],
  items: ActivityItem[]
): string {
  const t = useTranslations("CompactView")
  const tActivity = useTranslations("Folder.chat.activity")
  const text = pieces
    .map((piece) => t(PIECE_KEY[piece.category], { count: piece.count }))
    .join(tActivity("row.listJoiner"))
  if (!text) {
    return tActivity("header.steps", {
      count: items.flatMap(itemSteps).length,
    })
  }
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/** The glyph of a group's line: that of the kind it names first. */
function PieceIcon({
  category,
  className,
}: {
  category: GroupSummaryPiece["category"] | undefined
  className?: string
}) {
  switch (category) {
    case "commands":
      return <TerminalIcon aria-hidden="true" className={className} />
    case "editedFiles":
      return <FilePenLineIcon aria-hidden="true" className={className} />
    case "agents":
      return <BotIcon aria-hidden="true" className={className} />
    case "mcp":
      return <PlugIcon aria-hidden="true" className={className} />
    case "web":
      return <GlobeIcon aria-hidden="true" className={className} />
    case "readFiles":
      return <FileTextIcon aria-hidden="true" className={className} />
    case "searches":
      return <SearchIcon aria-hidden="true" className={className} />
    case "thought":
      return <THOUGHT_ICON aria-hidden="true" className={className} />
    case "other":
    case undefined:
      return <GROUP_ICON aria-hidden="true" className={className} />
  }
}

/** The word a live line puts before a call's target, by its kind (the
 *  activity rows' own words). */
const TOOL_VERB = {
  read: "stepVerb.read",
  search: "stepVerb.search",
  glob: "stepVerb.glob",
  list: "stepVerb.list",
  fetch: "stepVerb.fetch",
  "web-search": "stepVerb.webSearch",
  memory: "stepVerb.memory",
  command: "row.command",
  script: "row.codexScript",
  "shell-session": "row.command",
  monitor: "row.monitor",
  network: "row.networkAccess",
  edit: "row.editing",
  mcp: "kind.mcp",
  skill: "row.skill",
  todo: "row.todos",
  agent: "kind.agent",
  "collab-agent": "kind.agent",
  delegation: "kind.delegation",
  "delegation-status": "kind.delegation",
  "delegation-cancel": "kind.delegation",
  "delegation-resume": "kind.delegation",
  goal: "kind.goal",
  "plan-mode": "kind.plan",
  question: "kind.question",
  feedback: "kind.tool",
  workbench: "kind.tool",
  compaction: "kind.other",
  completion: "row.completion",
  generic: "kind.tool",
} as const satisfies Record<ToolStepKind, string>

/** What a live line says the agent is doing, and its glyph. */
function useStepLine(step: ActivityStep | null): {
  icon: ActivityIcon
  label: string
} {
  const t = useTranslations("Folder.chat.activity")
  if (!step) return { icon: THOUGHT_ICON, label: t("row.thinking") }
  switch (step.type) {
    case "thought":
      return { icon: THOUGHT_ICON, label: t("row.thinking") }
    case "tool": {
      const { tool } = step
      const verb = t(TOOL_VERB[tool.kind])
      const target =
        tool.target?.text ??
        tool.command?.display ??
        (tool.mcp ? tool.mcp.tool : null)
      return {
        icon: toolIcon(tool),
        label: target ? `${verb} ${target}` : verb,
      }
    }
    case "plan":
      return { icon: PLAN_ICON, label: t("kind.plan") }
    case "image":
    case "image-job":
      return { icon: IMAGE_ICON, label: t("kind.image") }
    case "goal":
      return { icon: GOAL_ICON, label: t("kind.goal") }
    case "delegation-polls":
      return { icon: GROUP_ICON, label: t("kind.delegation") }
    case "background-tasks":
      return { icon: GROUP_ICON, label: t("kind.background") }
    case "tool-result":
      return { icon: GROUP_ICON, label: t("row.toolResult") }
    case "note":
      return { icon: GROUP_ICON, label: t("kind.other") }
    default: {
      const unhandled: never = step
      return unhandled
    }
  }
}

/** Zen: the step under way as a line of words, nothing to open. */
function ZenPreview({ model }: { model: ActivityModel }) {
  const last = model.steps[model.steps.length - 1]
  const text =
    last?.type === "thought" ? last.part.content.trim().split("\n")[0] : ""
  if (!text) return null
  return <p className="compact-zen-preview">{text}</p>
}

/** "Working for 12s" while the agent works (and its speed, when the setting
 *  asks for it): T3 Code's working row, a clock with a light running across
 *  it, nothing to open. */
function WorkingLine({
  liveMessage,
  showSpeed,
}: {
  liveMessage: LiveMessage | null
  showSpeed: boolean
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
  return (
    <div className="compact-turn-line" data-compact-working="">
      <span className="compact-shine tabular-nums">
        {t("workingFor", {
          time: formatElapsedLabel(now - startedAt, tElapsed),
        })}
      </span>
      {showSpeed && liveMessage ? (
        <span className="compact-turn-line-meta">
          <LiveSpeed message={liveMessage} />
        </span>
      ) : null}
    </div>
  )
}

function LiveSpeed({ message }: { message: LiveMessage }) {
  const tps = useTokenOutputSpeed(message)
  if (tps == null) return null
  return <span className="shrink-0 tabular-nums">{tps.toFixed(1)} tok/s</span>
}

/** "Worked for 12s ›" — the working line once the reply is done, with
 *  everything before the answer folded under it. */
function FoldLine({
  durationMs,
  open,
  onToggle,
}: {
  durationMs?: number | null
  open: boolean
  onToggle?: () => void
}) {
  const t = useTranslations("CompactView")
  const tElapsed = useTranslations("Folder.chat.liveTurnStats")
  const hold = useHoldInPlace()
  const label =
    typeof durationMs === "number" && durationMs > 0
      ? t("workedFor", { time: formatElapsedLabel(durationMs, tElapsed) })
      : t("worked")
  return (
    <div className="compact-turn-line">
      {onToggle ? (
        <button
          type="button"
          className="compact-fold-button"
          data-compact-fold=""
          aria-expanded={open}
          onClick={(event) => hold(event.currentTarget, onToggle)}
        >
          <span>{label}</span>
          {open ? (
            <ChevronDownIcon aria-hidden="true" />
          ) : (
            <ChevronRightIcon aria-hidden="true" />
          )}
        </button>
      ) : (
        <span data-compact-fold="">{label}</span>
      )}
    </div>
  )
}
