"use client"

/**
 * keh4l build: finished delegations handed back to the parent agent
 * (`acp::delegation::delivery` in the backend).
 *
 * - A `system` turn of nothing but `delegation-results` parts — Codeg woke the
 *   agent with them, or steered them into its turn — is one centered row,
 *   "results handed back · Codex #9f3a1c done · 1m 34s", that opens to each
 *   task's preview and a link to its session.
 * - Results that rode along with the user's message are a small tag under the
 *   bubble, opening the same list.
 *
 * Neither is something the user said: the row's footnote says so.
 */

import {
  memo,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { useTranslations } from "next-intl"
import {
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  GitBranch,
} from "lucide-react"

import {
  DelegationIdentityAvatar,
  DelegationIdentityName,
} from "@/components/message/delegation-identity"
import { useSessionViewerHost } from "@/components/message/session-viewer-host-context"
import { useElapsedLabel } from "@/hooks/use-elapsed-label"
import type { DelegationIdentity } from "@/hooks/use-delegation-card-model"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { coerceAgentType } from "@/lib/delegation-card"
import {
  attachedResultsFor,
  subscribeDelegationResultsLive,
} from "@/lib/delegation-results-live"
import type {
  DelegationResultsMode,
  DelegationResultsTask,
  MessageTurn,
} from "@/lib/types"
import { cn } from "@/lib/utils"

type ResultsPart = Extract<AdaptedContentPart, { type: "delegation-results" }>

function isResultsPart(part: AdaptedContentPart): part is ResultsPart {
  return part.type === "delegation-results"
}

/** A `system` group that is nothing but handed-back delegation results. */
export function isDelegationResultsGroup(group: {
  parts: AdaptedContentPart[]
}): boolean {
  return group.parts.length > 0 && group.parts.every(isResultsPart)
}

/** `parts` without the results that rode along — the SAME array when there
 *  are none, so a memoized bubble keeps its props. */
export function withoutDelegationResults(
  parts: AdaptedContentPart[]
): AdaptedContentPart[] {
  return parts.some(isResultsPart)
    ? parts.filter((part) => !isResultsPart(part))
    : parts
}

/** Every task of the given parts, once each (a batch can be both live and
 *  reloaded for a moment). */
function collectTasks(parts: AdaptedContentPart[]): {
  mode: DelegationResultsMode
  tasks: DelegationResultsTask[]
} | null {
  const results = parts.filter(isResultsPart)
  if (results.length === 0) return null
  const seen = new Set<string>()
  const tasks: DelegationResultsTask[] = []
  for (const part of results) {
    for (const task of part.tasks) {
      if (seen.has(task.task_id)) continue
      seen.add(task.task_id)
      tasks.push(task)
    }
  }
  return { mode: results[0].mode, tasks }
}

function identityOf(task: DelegationResultsTask): DelegationIdentity {
  return {
    agentType: coerceAgentType(task.agent_type),
    assistantId: null,
    assistantName: task.assistant ?? null,
  }
}

function shortId(taskId: string): string {
  return taskId.replace(/-/g, "").slice(0, 6)
}

function useStatusLabel() {
  const t = useTranslations("Folder.chat.delegationResults")
  return (task: DelegationResultsTask) => {
    switch (task.status) {
      case "completed":
        return t("status.completed")
      case "canceled":
        return t("status.canceled")
      default:
        return task.resumable ? t("status.interrupted") : t("status.failed")
    }
  }
}

function TaskName({ task }: { task: DelegationResultsTask }) {
  const identity = useMemo(() => identityOf(task), [task])
  if (task.assistant) {
    return <span className="font-medium text-foreground">{task.assistant}</span>
  }
  return (
    <DelegationIdentityName
      identity={identity}
      className="font-medium text-foreground"
    />
  )
}

function TaskList({ tasks }: { tasks: DelegationResultsTask[] }) {
  const t = useTranslations("Folder.chat.delegationResults")
  const elapsed = useElapsedLabel()
  const statusLabel = useStatusLabel()
  const viewerHost = useSessionViewerHost()
  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task) => {
        const identity = identityOf(task)
        const duration = elapsed(task.duration_ms)
        return (
          <div
            key={task.task_id}
            data-testid="delegation-results-task"
            className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <DelegationIdentityAvatar identity={identity} size="overlay" />
              <TaskName task={task} />
              <span className="min-w-0 truncate text-muted-foreground">
                #{shortId(task.task_id)} · {statusLabel(task)}
                {duration ? ` · ${duration}` : ""}
              </span>
              {viewerHost ? (
                <button
                  type="button"
                  className="ms-auto shrink-0 cursor-pointer text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() =>
                    viewerHost.open({
                      kind: "delegation",
                      source: {
                        parentToolUseId: `delegation-results:${task.task_id}`,
                        taskIdHint: task.task_id,
                        meta: {
                          "codeg.delegation": {
                            status:
                              task.status === "completed"
                                ? "completed"
                                : "failed",
                            child_conversation_id: task.child_conversation_id,
                            task_id: task.task_id,
                            agent_type: task.agent_type,
                            error_code: task.error_code ?? undefined,
                          },
                        },
                      },
                    })
                  }
                >
                  {t("openSession")}
                </button>
              ) : null}
            </div>
            {task.worktree ? (
              <div className="mt-1 flex min-w-0 items-center gap-1 text-muted-foreground">
                <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate font-mono" title={task.worktree.path}>
                  {task.worktree.branch}
                </span>
                {task.worktree.changes ? (
                  <span className="shrink-0">· {task.worktree.changes}</span>
                ) : null}
              </div>
            ) : null}
            {task.preview ? (
              <p className="mt-1 line-clamp-6 whitespace-pre-wrap wrap-break-word text-muted-foreground">
                {task.preview}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** One line naming the first task, and how many more there are. */
function Summary({ tasks }: { tasks: DelegationResultsTask[] }) {
  const t = useTranslations("Folder.chat.delegationResults")
  const elapsed = useElapsedLabel()
  const statusLabel = useStatusLabel()
  const first = tasks[0]
  const identity = useMemo(() => identityOf(first), [first])
  const duration = elapsed(first.duration_ms)
  return (
    <>
      <DelegationIdentityAvatar identity={identity} size="overlay" />
      <TaskName task={first} />
      <span className="text-muted-foreground">
        #{shortId(first.task_id)} {statusLabel(first)}
        {duration ? ` · ${duration}` : ""}
        {tasks.length > 1 ? t("more", { count: tasks.length - 1 }) : ""}
      </span>
    </>
  )
}

/** A `system` group of handed-back results: one centered row. */
export const DelegationResultsRows = memo(function DelegationResultsRows({
  parts,
}: {
  parts: AdaptedContentPart[]
}) {
  const t = useTranslations("Folder.chat.delegationResults")
  const [open, setOpen] = useState(false)
  const collected = useMemo(() => collectTasks(parts), [parts])
  if (!collected || collected.tasks.length === 0) return null
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div data-testid="delegation-results-row" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex max-w-[90%] min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1 text-xs text-foreground/90 outline-none transition-colors hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <CornerDownLeft
            aria-hidden="true"
            className="size-3.5 shrink-0 text-primary"
          />
          <span className="shrink-0 font-medium">
            {collected.mode === "wake"
              ? t("heading.wake")
              : collected.mode === "steer"
                ? t("heading.steer")
                : t("heading.attached")}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Summary tasks={collected.tasks} />
          </span>
          <Chevron aria-hidden="true" className="size-3 shrink-0" />
        </button>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      {open ? (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
          <TaskList tasks={collected.tasks} />
          <p className="px-1 text-[11px] text-muted-foreground">
            {t("footnote")}
          </p>
        </div>
      ) : null}
    </div>
  )
})

/** Results that rode along with the user's message: a tag under the bubble.
 *  Live, before the transcript is reloaded, they are found by the message's
 *  id (`sourceTurns`) in `@/lib/delegation-results-live`. */
export const DelegationResultsAttached = memo(
  function DelegationResultsAttached({
    parts,
    sourceTurns,
  }: {
    parts: AdaptedContentPart[]
    sourceTurns?: MessageTurn[]
  }) {
    const t = useTranslations("Folder.chat.delegationResults")
    const [open, setOpen] = useState(false)
    const getLive = useCallback(
      () => attachedResultsFor(sourceTurns?.map((turn) => turn.id)),
      [sourceTurns]
    )
    const live = useSyncExternalStore(
      subscribeDelegationResultsLive,
      getLive,
      () => null
    )
    const collected = useMemo(
      () =>
        collectTasks(
          live
            ? [...parts, { type: "delegation-results" as const, ...live }]
            : parts
        ),
      [parts, live]
    )
    if (!collected || collected.tasks.length === 0) return null
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <div
        data-testid="delegation-results-attached"
        className="ml-auto flex w-fit max-w-full flex-col items-end gap-1.5"
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-sm text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          )}
        >
          <CornerDownLeft aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">
            {t("attached", { count: collected.tasks.length })}
          </span>
          <Chevron aria-hidden="true" className="size-3 shrink-0" />
        </button>
        {open ? (
          <div className="w-[min(32rem,100%)]">
            <TaskList tasks={collected.tasks} />
          </div>
        ) : null}
      </div>
    )
  }
)
