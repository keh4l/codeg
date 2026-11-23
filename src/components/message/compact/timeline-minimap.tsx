"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"

import {
  getConversationMinimap,
  type ConversationMinimapEntry,
} from "@/lib/transcript-view-api"
import { cn } from "@/lib/utils"

/**
 * Server lists kept per conversation (fork), so a remount, a reconnect or a
 * page of older history loading in does not ask the server again. A list
 * covers every turn before the window it was fetched for; it is fetched again
 * only when the window starts later than that (turns it does not know sit
 * between), or starts at the same turn over a different history (the
 * window's `prefixHash` changed: the history before it was rewritten).
 */
interface CachedMinimap {
  entries: ConversationMinimapEntry[]
  offset: number
  prefixHash: string | null
}
const MAX_CACHED_MINIMAPS = 32
const minimapCache = new Map<number, CachedMinimap>()

function cachedMinimap(
  conversationId: number,
  offset: number,
  prefixHash: string | null
): ConversationMinimapEntry[] | null {
  const cached = minimapCache.get(conversationId)
  if (!cached) return null
  if (offset > cached.offset) return null
  if (offset === cached.offset && prefixHash !== cached.prefixHash) return null
  return cached.entries
}

function rememberMinimap(conversationId: number, value: CachedMinimap) {
  minimapCache.delete(conversationId)
  minimapCache.set(conversationId, value)
  if (minimapCache.size > MAX_CACHED_MINIMAPS) {
    const oldest = minimapCache.keys().next().value
    if (oldest !== undefined) minimapCache.delete(oldest)
  }
}

/** @internal Test-only. */
export function __resetMinimapCacheForTests() {
  minimapCache.clear()
}

export interface MinimapLocalTurn {
  turnIndex: number
  turnId: string
  prompt: string
  reply: string | null
  timestamp: string
}

/**
 * keh4l build: T3-style timeline minimap along the left edge of the
 * conversation viewport.
 *
 * - Shown only when there are ≥ 2 user turns, desktop width (hidden < 768px),
 *   and `prefs.minimap` is enabled.
 * - One tick per user message; the active viewport turn is highlighted; ticks
 *   near the pointer magnify smoothly.
 * - Hovering a tick shows a glass preview card with the 1-line prompt and up
 *   to 3 lines of the reply.
 * - Clicking jumps to that turn (loading older history when needed).
 */
export const TimelineMinimap = memo(function TimelineMinimap({
  conversationId,
  turnsOffset,
  prefixHash,
  localTurns,
  activeTurnId,
  onJump,
}: {
  conversationId: number
  /** Global index of the first loaded turn. At 0 the loaded turns are the
   *  whole history and the server is not asked. */
  turnsOffset: number
  /** The loaded window's fingerprint of the history before it. */
  prefixHash: string | null
  /** Loaded / optimistic user turns from the current viewport window, merged on
   *  top of the server list so fresh sends appear before DB reparse completes. */
  localTurns: readonly MinimapLocalTurn[]
  /** Turn id of the user turn currently at the top of (or nearest to) the
   *  viewport. */
  activeTurnId: string | null
  onJump: (entry: { turnIndex: number; turnId: string }) => void
}) {
  const t = useTranslations("CompactView")
  const [serverEntries, setServerEntries] = useState<
    ConversationMinimapEntry[]
  >([])
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [pointerY, setPointerY] = useState<number | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const tickRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Only the turns before the loaded window come from the server (the loaded
  // and live ones are `localTurns`), so the list is asked for once per
  // conversation, not per settled turn (fork, `cachedMinimap`).
  useEffect(() => {
    if (conversationId <= 0 || turnsOffset <= 0) {
      setServerEntries([])
      return
    }
    const cached = cachedMinimap(conversationId, turnsOffset, prefixHash)
    if (cached) {
      setServerEntries(cached)
      return
    }
    let cancelled = false
    getConversationMinimap(conversationId)
      .then((rows) => {
        rememberMinimap(conversationId, {
          entries: rows,
          offset: turnsOffset,
          prefixHash,
        })
        if (!cancelled) setServerEntries(rows)
      })
      .catch(() => {
        // Offline / unsaved draft: fall back to localTurns cleanly.
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, turnsOffset, prefixHash])

  // Merge server entries (full conversation history) with any newer local turns
  // not yet persisted by the parser. Keyed by `turnIndex` first because
  // in-flight user turns can be renamed by live broadcast ids.
  const entries = useMemo(() => {
    const byIndex = new Map<number, MinimapLocalTurn>()
    const list: MinimapLocalTurn[] = []
    for (const s of serverEntries) {
      const item: MinimapLocalTurn = {
        turnIndex: s.turn_index,
        turnId: s.turn_id,
        prompt: s.prompt,
        reply: s.reply,
        timestamp: s.timestamp,
      }
      byIndex.set(item.turnIndex, item)
      list.push(item)
    }
    for (const local of localTurns) {
      const existing = byIndex.get(local.turnIndex)
      if (existing) {
        if (!existing.reply && local.reply) existing.reply = local.reply
        existing.turnId = local.turnId
      } else {
        byIndex.set(local.turnIndex, local)
        list.push(local)
      }
    }
    list.sort((a, b) => a.turnIndex - b.turnIndex)
    return list
  }, [serverEntries, localTurns])

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = railRef.current?.getBoundingClientRect()
      if (!rect) return
      setPointerY(event.clientY - rect.top)
    },
    []
  )

  const handlePointerLeave = useCallback(() => {
    setPointerY(null)
    setHoveredIdx(null)
  }, [])

  if (entries.length < 2) return null

  const hovered =
    hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < entries.length
      ? entries[hoveredIdx]!
      : null

  // Vertical position (px within the rail) for the floating preview card.
  const hoveredTop = (() => {
    if (hoveredIdx === null || !railRef.current) return 0
    const btn = tickRefs.current[hoveredIdx]
    if (!btn) return 0
    const railRect = railRef.current.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    return Math.max(
      0,
      Math.min(railRect.height - 64, btnRect.top - railRect.top - 16)
    )
  })()

  return (
    <nav
      aria-label={t("minimapLabel")}
      data-compact-minimap=""
      className="pointer-events-auto absolute start-1 top-1/2 z-20 hidden w-[18px] -translate-y-1/2 select-none flex-col items-start md:flex"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div
        ref={railRef}
        className="relative flex max-h-[60vh] w-full flex-col items-start gap-1 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map((entry, idx) => {
          const isActive =
            activeTurnId !== null
              ? entry.turnId === activeTurnId
              : idx === entries.length - 1
          let proximity = 0
          if (pointerY !== null && railRef.current) {
            const btn = tickRefs.current[idx]
            if (btn) {
              const railRect = railRef.current.getBoundingClientRect()
              const btnRect = btn.getBoundingClientRect()
              const center = btnRect.top + btnRect.height / 2 - railRect.top
              const dist = Math.abs(center - pointerY)
              proximity = Math.max(0, 1 - dist / 44)
            }
          }
          const barWidth = Math.round(
            (isActive ? 14 : 8) + proximity * (isActive ? 4 : 8)
          )
          return (
            <button
              key={entry.turnId}
              ref={(el) => {
                tickRefs.current[idx] = el
              }}
              type="button"
              data-compact-minimap-tick=""
              data-active={isActive ? "true" : undefined}
              aria-label={
                entry.prompt || t("minimapTurnAria", { index: idx + 1 })
              }
              aria-current={isActive ? "true" : undefined}
              onMouseEnter={() => setHoveredIdx(idx)}
              onFocus={() => setHoveredIdx(idx)}
              onBlur={() => setHoveredIdx((cur) => (cur === idx ? null : cur))}
              onClick={() =>
                onJump({ turnIndex: entry.turnIndex, turnId: entry.turnId })
              }
              className="group/tick flex h-2.5 w-full cursor-pointer items-center py-0.5 focus-visible:outline-none"
            >
              <span
                style={{ width: barWidth }}
                className={cn(
                  "block h-[2px] rounded-full transition-[width,background-color,opacity] duration-100",
                  isActive
                    ? "bg-foreground opacity-95"
                    : "bg-muted-foreground/55 opacity-70 group-hover/tick:bg-foreground group-hover/tick:opacity-100"
                )}
              />
            </button>
          )
        })}
      </div>

      {hovered ? (
        <div
          data-compact-minimap-preview=""
          style={{ top: hoveredTop }}
          className="pointer-events-none absolute start-6 z-30 w-64 rounded-xl border border-border/80 bg-popover/90 p-2.5 text-xs shadow-lg backdrop-blur-md"
        >
          <p className="truncate font-medium text-foreground">
            {hovered.prompt || t("minimapEmptyPrompt")}
          </p>
          <p className="mt-1 line-clamp-3 text-[0.6875rem] leading-relaxed text-muted-foreground">
            {hovered.reply ?? t("minimapNoReply")}
          </p>
        </div>
      ) : null}
    </nav>
  )
})
