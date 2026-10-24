"use client"

import { memo } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  usePlanTranslation,
  type CardTranslation,
} from "@/hooks/use-card-translation"
import type { PlanEntryInfo } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  LanguagesIcon,
  Loader2Icon,
} from "lucide-react"

// ── Shared status/priority label + style helpers ──────────────────────
// Single source of truth for plan entry labels/colors, shared by the timeline's
// plan row and <AgentPlanOverlay> (floating chip) so the two surfaces never
// drift.

export type StatusKey =
  | "status.completed"
  | "status.inProgress"
  | "status.pending"
  | "status.unknown"

export function getStatusKey(status: string): StatusKey {
  switch (status) {
    case "completed":
      return "status.completed"
    case "in_progress":
      return "status.inProgress"
    case "pending":
      return "status.pending"
    default:
      return "status.unknown"
  }
}

export type PriorityKey =
  | "priority.high"
  | "priority.medium"
  | "priority.low"
  | "priority.unknown"

export function getPriorityKey(priority: string): PriorityKey {
  switch (priority) {
    case "high":
      return "priority.high"
    case "medium":
      return "priority.medium"
    case "low":
      return "priority.low"
    default:
      return "priority.unknown"
  }
}

export function getPriorityClassName(priority: string): string {
  switch (priority) {
    case "high":
      return "text-tone-danger bg-tone-danger/10 border-tone-danger/20"
    case "medium":
      return "text-tone-warning bg-tone-warning/10 border-tone-warning/20"
    case "low":
      return "text-muted-foreground bg-muted border-border"
    default:
      return "text-muted-foreground"
  }
}

function StatusIcon({
  status,
  isStreaming,
}: {
  status: string
  isStreaming: boolean
}) {
  // Centred on the entry's 1.5rem line. A finished step is grey like the
  // timeline's finished steps; the one in progress is the one in ink.
  const className = "mt-[0.3125rem] size-3.5 shrink-0"
  if (status === "completed") {
    return (
      <CheckCircle2Icon
        aria-hidden="true"
        className={cn(className, "text-muted-foreground")}
      />
    )
  }
  if (status === "in_progress") {
    return isStreaming ? (
      <Loader2Icon
        aria-hidden="true"
        className={cn(className, "animate-spin text-foreground/80")}
      />
    ) : (
      <CircleDotIcon
        aria-hidden="true"
        className={cn(className, "text-foreground/80")}
      />
    )
  }
  return (
    <CircleDashedIcon
      aria-hidden="true"
      className={cn(className, "text-muted-foreground")}
    />
  )
}

const AS_WRITTEN = (text: string) => text

/**
 * A plan's translate button, on every plan surface that has one: shows the
 * steps in the reader's language, or back as the agent wrote them. Nothing
 * when there is nothing to translate.
 */
export function PlanTranslateButton({
  translation,
}: {
  translation: CardTranslation
}) {
  const t = useTranslations("Folder.chat.agentPlanOverlay")
  if (!translation.offered) return null
  const label = translation.translated ? t("showOriginal") : t("translatePlan")
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn(
        "shrink-0 text-muted-foreground",
        translation.translated && "text-foreground"
      )}
      aria-label={label}
      aria-pressed={translation.translated}
      title={label}
      onClick={translation.toggle}
    >
      {translation.pending ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <LanguagesIcon className="size-3.5" />
      )}
    </Button>
  )
}

/**
 * The plan entry rows (checklist body) of the timeline's plan and todo rows:
 * one line per step, set in the row's content column — the status glyph under
 * the row's label, the priority at the end, under the row's own figure.
 * `shown` gives each step as it reads — its translation, when one shows.
 */
export const PlanEntriesList = memo(function PlanEntriesList({
  entries,
  isStreaming = false,
  shown = AS_WRITTEN,
}: {
  entries: PlanEntryInfo[]
  isStreaming?: boolean
  shown?: (text: string) => string
}) {
  const t = useTranslations("Folder.chat.agentPlanOverlay")

  if (entries.length === 0) return null
  // A priority every step shares says nothing — agents that send none get
  // "medium" throughout — so only a plan that ranks its steps shows them.
  const ranked = new Set(entries.map((entry) => entry.priority)).size > 1

  return (
    <ol role="list" className="space-y-1">
      {entries.map((entry, index) => (
        <li
          key={`${entry.content}-${index}`}
          className="flex items-start gap-2.5 text-start text-sm leading-6"
        >
          <StatusIcon status={entry.status} isStreaming={isStreaming} />
          <span className="sr-only">{t(getStatusKey(entry.status))}</span>
          <span
            dir="auto"
            className={cn(
              "min-w-0 break-words [overflow-wrap:anywhere]",
              entry.status === "completed"
                ? "text-muted-foreground"
                : entry.status === "in_progress"
                  ? "font-medium text-foreground"
                  : "text-foreground/90"
            )}
          >
            {shown(entry.content)}
          </span>
          {ranked ? (
            <span className="activity-mono ms-auto shrink-0 ps-3 text-xs leading-6 text-muted-foreground">
              {t(getPriorityKey(entry.priority))}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
})

/** A todo update's checklist, translated like the plan row it stands beside
 *  (the button lives on that row and on the floating plan). */
export function TranslatedPlanEntries({
  entries,
}: {
  entries: PlanEntryInfo[]
}) {
  const { shown } = usePlanTranslation(entries)
  return <PlanEntriesList entries={entries} shown={shown} />
}
