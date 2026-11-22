"use client"

/**
 * keh4l build: how steered messages show in the transcript.
 *
 * - A user turn that was steered into a running turn carries a「插话」mark.
 * - A steer on an agent without native steering cut the running turn off and
 *   started a new one; the reply it cut off folds into「被插话打断的尝试」.
 *
 * Turns are matched to the server's steer records by text: the transcript
 * comes from the agent's own session files, which know nothing of codeg's ids.
 */

import { useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, ChevronRight, Forward } from "lucide-react"

import type {
  ResolvedMessageGroup,
  ThreadRenderItem,
} from "@/components/message/message-list-view"
import type { FollowUpSteerRecord } from "@/lib/follow-up/api"

/** Whitespace-insensitive form used to match a turn to a steer record. */
export function normalizeSteerText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** All text of a user group, joined. */
export function groupText(group: ResolvedMessageGroup): string {
  return group.parts
    .map((part) =>
      part.type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : ""
    )
    .join("\n")
}

export interface SteerLookup {
  find: (group: ResolvedMessageGroup) => FollowUpSteerRecord | null
}

/** Index steer records for matching user turns by their text. */
export function buildSteerLookup(records: FollowUpSteerRecord[]): SteerLookup {
  const shown = records.filter(
    (r) => r.status === "sent" || r.status === "pending"
  )
  const byText = new Map<string, FollowUpSteerRecord>()
  for (const record of shown) {
    const key = normalizeSteerText(record.text)
    if (key) byText.set(key, record)
  }
  return {
    find(group) {
      if (group.role !== "user" || byText.size === 0) return null
      const text = normalizeSteerText(groupText(group))
      if (!text) return null
      const exact = byText.get(text)
      if (exact) return exact
      // An agent may echo the steer with framing of its own around it.
      for (const [key, record] of byText) {
        if (key.length >= 8 && text.includes(key)) return record
      }
      return null
    },
  }
}

/**
 * Keys of the assistant items a restart cut off: every assistant turn right
 * before a user turn `isRestartTurn` accepts, back to the previous user turn.
 */
export function findInterruptedReplies(
  items: ThreadRenderItem[],
  isRestartTurn: ((group: ResolvedMessageGroup) => boolean) | null
): Set<string> {
  const keys = new Set<string>()
  if (!isRestartTurn) return keys
  items.forEach((item, index) => {
    if (item.kind !== "turn" || item.group.role !== "user") return
    if (!isRestartTurn(item.group)) return
    for (let j = index - 1; j >= 0; j--) {
      const prev = items[j]
      if (prev.kind !== "turn" || prev.group.role !== "assistant") break
      keys.add(prev.key)
    }
  })
  return keys
}

export function InterruptedAttemptFold({ children }: { children: ReactNode }) {
  const t = useTranslations("FollowUp")
  const [open, setOpen] = useState(false)
  return (
    <div className="pt-4" data-follow-up-interrupted="">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-start text-xs text-muted-foreground hover:bg-muted"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
        <span>{t("interruptedAttempt")}</span>
      </button>
      {open ? <div className="opacity-70">{children}</div> : null}
    </div>
  )
}

export function SteerMark({ pending }: { pending: boolean }) {
  const t = useTranslations("FollowUp")
  return (
    <div
      className="flex justify-end px-1 pt-1"
      data-follow-up-steer-mark={pending ? "pending" : "sent"}
    >
      <span
        className={
          pending
            ? "inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[0.6875rem] leading-none text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
            : "inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[0.6875rem] leading-none text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300"
        }
      >
        <Forward className="size-3" />
        {pending ? t("steerPending") : t("steered")}
      </span>
    </div>
  )
}
