"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import { CaseSensitive, ChevronDown, ChevronUp, Loader2, X } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  searchConversation,
  type ConversationSearchBlock,
  type ConversationSearchMatch,
} from "@/lib/transcript-view-api"
import { cn } from "@/lib/utils"
import type { MessageScrollContextValue } from "../message-scroll-context"
import { setFindTarget } from "./compact-thread"

const FIND_HIGHLIGHT_ALL = "codeg-find"
const FIND_HIGHLIGHT_ACTIVE = "codeg-find-active"
const FIND_MARK_ATTR = "data-codeg-find-mark"
const SEARCH_LIMIT = 1000

/** Event dispatched (e.g. from the header `…` menu) to open the active
 *  conversation's find bar. */
export const OPEN_THREAD_FIND_EVENT = "codeg:open-thread-find"

export function dispatchOpenThreadFind(conversationId?: number | null): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(OPEN_THREAD_FIND_EVENT, {
      detail: { conversationId: conversationId ?? null },
    })
  )
}

export interface LocalSearchTurn {
  turnIndex: number
  turnId: string
  role: "user" | "assistant" | "system"
  text: string
  thinking?: string
}

/** Case-fold matching the backend (`char::to_lowercase` one code point at a time). */
function foldCharByChar(s: string): string {
  return Array.from(s, (ch) => ch.toLowerCase()).join("")
}

/** Search unsaved local turns (e.g. live streaming reply not yet persisted). */
export function searchLocalTurns(
  turns: readonly LocalSearchTurn[],
  query: string,
  caseSensitive: boolean,
  coveredTurnIds: ReadonlySet<string>
): ConversationSearchMatch[] {
  if (!query.trim()) return []
  const needle = caseSensitive ? query : foldCharByChar(query)
  const out: ConversationSearchMatch[] = []
  for (const turn of turns) {
    if (coveredTurnIds.has(turn.turnId)) continue
    const scan = (raw: string, block: ConversationSearchBlock) => {
      if (!raw) return
      const hay = caseSensitive ? raw : foldCharByChar(raw)
      let from = 0
      let occ = 0
      while (from <= hay.length - needle.length) {
        const idx = hay.indexOf(needle, from)
        if (idx === -1) break
        out.push({
          turn_index: turn.turnIndex,
          turn_id: turn.turnId,
          role: turn.role,
          block,
          occurrence: occ,
          snippet: raw.slice(Math.max(0, idx - 40), idx + needle.length + 40),
          snippet_match_start: 0,
          snippet_match_end: 0,
        })
        occ += 1
        from = idx + Math.max(1, needle.length)
      }
    }
    scan(turn.text, "text")
    if (turn.thinking) scan(turn.thinking, "thinking")
  }
  return out
}

function supportsCssHighlight(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  )
}

/** Remove any previous CSS highlights or fallback `<mark>` nodes. */
export function clearFindHighlights(container: HTMLElement | null): void {
  if (supportsCssHighlight()) {
    try {
      CSS.highlights.delete(FIND_HIGHLIGHT_ALL)
      CSS.highlights.delete(FIND_HIGHLIGHT_ACTIVE)
    } catch {
      // Ignore in partial jsdom/browser shims.
    }
  }
  if (!container) return
  const marks = container.querySelectorAll(`mark[${FIND_MARK_ATTR}]`)
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  }
}

/**
 * Highlight every occurrence of `query` inside `container`, marking the
 * occurrence inside `[data-turn-id="<activeTurnId>"]` (at `activeOccurrence`)
 * as active, and scrolling that active match into view (unless
 * `options.scroll` is false). Uses CSS Custom Highlight API when available,
 * falling back to `<mark>` spans otherwise. Returns whether the active turn
 * held a match.
 */
export function applyFindHighlights(
  container: HTMLElement,
  query: string,
  caseSensitive: boolean,
  activeTurnIndex: number | null,
  activeTurnId: string | null,
  activeOccurrence: number,
  options: { scroll?: boolean } = {}
): boolean {
  const scroll = options.scroll ?? true
  clearFindHighlights(container)
  if (!query.trim()) return false

  const needle = caseSensitive ? query : foldCharByChar(query)
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement
      if (!el) return NodeFilter.FILTER_REJECT
      if (
        el.closest("[data-compact-find-bar]") ||
        el.closest("[data-compact-minimap]") ||
        el.tagName === "SCRIPT" ||
        el.tagName === "STYLE"
      ) {
        return NodeFilter.FILTER_REJECT
      }
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })

  const hits: Array<{
    node: Text
    start: number
    end: number
    inActiveTurn: boolean
  }> = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    const textNode = current as Text
    const raw = textNode.nodeValue ?? ""
    const hay = caseSensitive ? raw : foldCharByChar(raw)
    const el = textNode.parentElement
    const inActiveTurn =
      (activeTurnIndex !== null &&
        Boolean(el?.closest(`[data-turn-indices~="${activeTurnIndex}"]`))) ||
      (activeTurnId !== null &&
        Boolean(el?.closest(`[data-turn-ids~="${CSS.escape(activeTurnId)}"]`)))
    let from = 0
    while (from <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, from)
      if (idx === -1) break
      hits.push({
        node: textNode,
        start: idx,
        end: idx + needle.length,
        inActiveTurn,
      })
      from = idx + Math.max(1, needle.length)
    }
  }

  if (hits.length === 0) return false

  const turnHits = hits.filter((h) => h.inActiveTurn)
  const foundInTurn = turnHits.length > 0
  const activeHit =
    turnHits[Math.min(activeOccurrence, Math.max(0, turnHits.length - 1))] ??
    hits[0]!

  if (supportsCssHighlight()) {
    const allRanges: Range[] = []
    let activeRange: Range | null = null
    for (const hit of hits) {
      const range = document.createRange()
      range.setStart(hit.node, hit.start)
      range.setEnd(hit.node, hit.end)
      if (hit === activeHit) {
        activeRange = range
      } else {
        allRanges.push(range)
      }
    }
    try {
      if (allRanges.length > 0) {
        CSS.highlights.set(FIND_HIGHLIGHT_ALL, new Highlight(...allRanges))
      }
      if (activeRange) {
        CSS.highlights.set(FIND_HIGHLIGHT_ACTIVE, new Highlight(activeRange))
        if (scroll) {
          const targetEl = activeRange.startContainer.parentElement
          targetEl?.scrollIntoView({ block: "center", behavior: "auto" })
        }
      }
      return foundInTurn
    } catch {
      // Fall through to <mark> fallback if Highlight construction fails.
    }
  }

  // Fallback for environments without CSS Custom Highlight API (e.g. older
  // WebKitGTK): wrap matches from back to front per text node.
  const byNode = new Map<Text, typeof hits>()
  for (const hit of hits) {
    const list = byNode.get(hit.node) ?? []
    list.push(hit)
    byNode.set(hit.node, list)
  }
  let activeMark: HTMLElement | null = null
  for (const [textNode, nodeHits] of byNode) {
    for (let i = nodeHits.length - 1; i >= 0; i -= 1) {
      const hit = nodeHits[i]!
      const after = textNode.splitText(hit.end)
      const mid = textNode.splitText(hit.start)
      const mark = document.createElement("mark")
      const isAct = hit === activeHit
      mark.setAttribute(FIND_MARK_ATTR, isAct ? "active" : "match")
      mark.className = isAct ? "codeg-find-mark-active" : "codeg-find-mark"
      mark.appendChild(mid)
      after.parentNode?.insertBefore(mark, after)
      if (isAct) activeMark = mark
    }
  }
  if (scroll) activeMark?.scrollIntoView({ block: "center", behavior: "auto" })
  return foundInTurn
}

/** Scroll the current active find match (highlight range or fallback mark)
 *  into the middle of the viewport. */
export function scrollActiveFindMatchIntoView(
  container: HTMLElement | null
): void {
  let target: Element | null = null
  if (supportsCssHighlight()) {
    let range: AbstractRange | null = null
    CSS.highlights.get(FIND_HIGHLIGHT_ACTIVE)?.forEach((r) => {
      range ??= r
    })
    target =
      (range as AbstractRange | null)?.startContainer.parentElement ?? null
  }
  if (!target && container) {
    target = container.querySelector(`mark[${FIND_MARK_ATTR}="active"]`)
  }
  target?.scrollIntoView({ block: "center", behavior: "auto" })
}

interface FindHighlightRequest {
  query: string
  caseSensitive: boolean
  turnIndex: number
  turnId: string
  occurrence: number
  /** The view already landed on the real match; repaints must not scroll. */
  scrolled: boolean
  /** Repaints may still scroll to the match until then (content of a just
   *  unfolded turn can arrive a few frames after the jump). */
  scrollUntil: number
}

/** How long after a jump a late-rendered match may still pull the view. */
const LATE_MATCH_SCROLL_MS = 1500

/** Should Cmd/Ctrl+F be intercepted for the conversation find bar? Never steal
 *  it from the composer, inputs, terminal, or code editors. */
export function shouldInterceptFindKey(
  event: KeyboardEvent,
  container: HTMLElement | null,
  findInput: HTMLInputElement | null
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false
  if (event.key.toLowerCase() !== "f") return false
  const target = event.target as HTMLElement | null
  if (findInput && target === findInput) return true
  if (target) {
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      target.closest("[contenteditable='true']") ||
      target.closest(".xterm") ||
      target.closest(".cm-editor") ||
      target.closest(".monaco-editor")
    ) {
      return false
    }
    // Only intercept when focus is inside this conversation or on document body.
    if (
      container &&
      target !== document.body &&
      target !== document.documentElement &&
      !container.contains(target)
    ) {
      return false
    }
  }
  return true
}

/**
 * keh4l build: T3-style in-thread find bar (Cmd/Ctrl+F or header menu).
 *
 * Searches the ENTIRE parsed conversation on the backend (not only loaded
 * turns), pages older history when jumping to an unloaded match, unfolds
 * collapsed turns & tool/thought rows holding the match, and highlights hits
 * via the CSS Custom Highlight API (with `<mark>` fallback).
 */
export const ThreadFindBar = memo(function ThreadFindBar({
  conversationId,
  isActive,
  containerRef,
  scrollApiRef,
  threadIndexByTurnIndex,
  threadIndexByTurnId,
  localTurns,
  loadOlderTurnsThrough,
}: {
  conversationId: number
  isActive: boolean
  containerRef: RefObject<HTMLDivElement | null>
  scrollApiRef: RefObject<MessageScrollContextValue | null>
  /** Maps any loaded global turn index to its virtualizer index (primary). */
  threadIndexByTurnIndex: ReadonlyMap<number, number>
  /** Maps any loaded turn id (user or assistant) to its virtualizer index. */
  threadIndexByTurnId: ReadonlyMap<string, number>
  localTurns: readonly LocalSearchTurn[]
  loadOlderTurnsThrough: (
    conversationId: number,
    throughIndex: number
  ) => Promise<boolean>
}) {
  const t = useTranslations("CompactView")
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [serverMatches, setServerMatches] = useState<ConversationSearchMatch[]>(
    []
  )
  const [serverTotal, setServerTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  // Bumped by Enter / the arrows so stepping re-jumps even when the active
  // match stays the same (a single match, or wrapping back onto it).
  const [jumpSeq, setJumpSeq] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const tokenRef = useRef(0)
  const pendingJumpRef = useRef<{
    match: ConversationSearchMatch
    token: number
  } | null>(null)
  // The match being shown. Highlights are repainted from it whenever the
  // thread's DOM changes: React rewrites text nodes (which collapses a live
  // Range to nothing) and the virtualizer remounts rows scrolled back in.
  const highlightRef = useRef<FindHighlightRequest | null>(null)

  const paintHighlights = useCallback(
    (initial: boolean) => {
      const req = highlightRef.current
      const el = containerRef.current
      if (!req || !el) return
      const found = applyFindHighlights(
        el,
        req.query,
        req.caseSensitive,
        req.turnIndex,
        req.turnId,
        req.occurrence,
        { scroll: false }
      )
      if (req.scrolled) return
      if (initial || (found && performance.now() < req.scrollUntil)) {
        scrollActiveFindMatchIntoView(el)
      }
      if (found) req.scrolled = true
    },
    [containerRef]
  )

  /** First paint after the jump has scrolled the turn into the window. */
  const startPaint = useCallback(() => {
    const req = highlightRef.current
    if (!req) return
    req.scrollUntil = performance.now() + LATE_MATCH_SCROLL_MS
    paintHighlights(true)
  }, [paintHighlights])

  const resetHighlights = useCallback(() => {
    highlightRef.current = null
    setFindTarget(null)
    pendingJumpRef.current = null
    clearFindHighlights(containerRef.current)
  }, [containerRef])

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const coveredIndices = new Set(serverMatches.map((m) => m.turn_index))
    const coveredIds = new Set(serverMatches.map((m) => m.turn_id))
    const local = searchLocalTurns(
      localTurns.filter((lt) => !coveredIndices.has(lt.turnIndex)),
      query,
      caseSensitive,
      coveredIds
    )
    return local.length > 0 ? [...serverMatches, ...local] : serverMatches
  }, [serverMatches, localTurns, query, caseSensitive])

  const totalCount =
    serverTotal + Math.max(0, matches.length - serverMatches.length)

  const close = useCallback(() => {
    setOpen(false)
    resetHighlights()
  }, [resetHighlights])

  // Clear when switching conversations.
  useEffect(() => {
    resetHighlights()
    setServerMatches([])
    setServerTotal(0)
    setTruncated(false)
    setActiveIndex(0)
  }, [conversationId, resetHighlights])

  // Global Cmd/Ctrl+F listener & header menu trigger.
  useEffect(() => {
    if (!isActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !shouldInterceptFindKey(event, containerRef.current, inputRef.current)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      setOpen(true)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    const onOpenEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: number | null }>)
        .detail
      if (
        detail?.conversationId != null &&
        detail.conversationId !== conversationId
      ) {
        return
      }
      setOpen(true)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener(OPEN_THREAD_FIND_EVENT, onOpenEvent)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener(OPEN_THREAD_FIND_EVENT, onOpenEvent)
    }
  }, [isActive, conversationId, containerRef])

  // Debounced server search.
  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (!trimmed) {
      setServerMatches([])
      setServerTotal(0)
      setTruncated(false)
      setActiveIndex(0)
      resetHighlights()
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      if (conversationId <= 0) {
        setServerMatches([])
        setServerTotal(0)
        setTruncated(false)
        setLoading(false)
        return
      }
      searchConversation(conversationId, trimmed, {
        caseSensitive,
        limit: SEARCH_LIMIT,
      })
        .then((res) => {
          if (cancelled) return
          setServerMatches(res.matches)
          setServerTotal(res.total)
          setTruncated(res.truncated)
          setActiveIndex(0)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setServerMatches([])
          setServerTotal(0)
          setTruncated(false)
          setLoading(false)
        })
    }, 140)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, conversationId, query, caseSensitive, resetHighlights])

  // Jump & highlight a specific match.
  const revealMatch = useCallback(
    (match: ConversationSearchMatch) => {
      const token = ++tokenRef.current
      highlightRef.current = {
        query,
        caseSensitive,
        turnIndex: match.turn_index,
        turnId: match.turn_id,
        occurrence: match.occurrence,
        scrolled: false,
        scrollUntil: Number.POSITIVE_INFINITY,
      }
      setFindTarget({
        query,
        caseSensitive,
        turnIndex: match.turn_index,
        turnIds: new Set([match.turn_id]),
        block: match.block,
        token,
      })
      const threadIdx =
        threadIndexByTurnIndex.get(match.turn_index) ??
        threadIndexByTurnId.get(match.turn_id)
      if (threadIdx !== undefined) {
        pendingJumpRef.current = null
        scrollApiRef.current?.scrollToIndex(threadIdx, {
          align: "center",
          smooth: false,
        })
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (tokenRef.current !== token) return
            startPaint()
          })
        })
        return
      }
      // Match sits above the loaded history window: page it in first.
      pendingJumpRef.current = { match, token }
      if (conversationId > 0) {
        void loadOlderTurnsThrough(conversationId, match.turn_index)
      }
    },
    [
      query,
      caseSensitive,
      threadIndexByTurnIndex,
      threadIndexByTurnId,
      scrollApiRef,
      conversationId,
      loadOlderTurnsThrough,
      startPaint,
    ]
  )

  // Finish a pending cross-history jump once the turn lands in the loaded window.
  useEffect(() => {
    const pending = pendingJumpRef.current
    if (!pending) return
    const threadIdx =
      threadIndexByTurnIndex.get(pending.match.turn_index) ??
      threadIndexByTurnId.get(pending.match.turn_id)
    if (threadIdx === undefined) return
    pendingJumpRef.current = null
    const { token } = pending
    const frame = requestAnimationFrame(() => {
      scrollApiRef.current?.scrollToIndex(threadIdx, {
        align: "center",
        smooth: false,
      })
      requestAnimationFrame(() => {
        if (tokenRef.current !== token) return
        startPaint()
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [threadIndexByTurnIndex, threadIndexByTurnId, scrollApiRef, startPaint])

  // Reveal active match whenever the match list or index moves.
  const activeMatch =
    open && matches.length > 0
      ? matches[Math.min(activeIndex, matches.length - 1)]!
      : null
  useEffect(() => {
    if (!open || !activeMatch) return
    revealMatch(activeMatch)
  }, [open, activeMatch, revealMatch, jumpSeq])

  // Keep the highlights on the live DOM while the bar is open (see
  // `highlightRef`). Painting with the Highlight API doesn't touch the DOM;
  // the `<mark>` fallback does, so its own mutations are dropped.
  useEffect(() => {
    const el = containerRef.current
    if (!open || !el) return
    let frame = 0
    const observer = new MutationObserver(() => {
      if (frame || !highlightRef.current) return
      frame = requestAnimationFrame(() => {
        frame = 0
        paintHighlights(false)
        observer.takeRecords()
      })
    })
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [open, containerRef, paintHighlights])

  // Clean up highlights on unmount.
  useEffect(() => {
    const el = containerRef.current
    return () => {
      highlightRef.current = null
      setFindTarget(null)
      clearFindHighlights(el)
    }
  }, [containerRef])

  const step = useCallback(
    (delta: number) => {
      if (matches.length === 0) return
      setActiveIndex((cur) => (cur + delta + matches.length) % matches.length)
      setJumpSeq((n) => n + 1)
    },
    [matches.length]
  )

  if (!open) return null

  const countLabel = !query.trim()
    ? ""
    : matches.length === 0
      ? "0/0"
      : `${Math.min(activeIndex + 1, matches.length)}/${truncated ? `${SEARCH_LIMIT}+` : totalCount}`

  return (
    <div
      role="search"
      aria-label={t("findInConversation")}
      data-compact-find-bar=""
      className="absolute end-4 top-3 z-30 flex items-center gap-1 rounded-xl border border-border bg-popover/95 px-2 py-1.5 text-xs shadow-lg backdrop-blur-md"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            close()
          } else if (e.key === "Enter") {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          }
        }}
        placeholder={t("findPlaceholder")}
        aria-label={t("findPlaceholder")}
        className="w-40 bg-transparent px-1 text-xs text-foreground outline-none placeholder:text-muted-foreground sm:w-52"
      />

      {loading ? (
        <Loader2
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin text-muted-foreground"
        />
      ) : countLabel ? (
        <span
          data-compact-find-count=""
          className="shrink-0 px-1 font-mono text-[0.6875rem] tabular-nums text-muted-foreground"
        >
          {countLabel}
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => setCaseSensitive((v) => !v)}
        aria-pressed={caseSensitive}
        aria-label={t("findCaseSensitive")}
        title={t("findCaseSensitive")}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          caseSensitive && "bg-muted text-foreground"
        )}
      >
        <CaseSensitive className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={() => step(-1)}
        disabled={matches.length === 0}
        aria-label={t("findPrevious")}
        title={t("findPrevious")}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <ChevronUp className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={() => step(1)}
        disabled={matches.length === 0}
        aria-label={t("findNext")}
        title={t("findNext")}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <ChevronDown className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={close}
        aria-label={t("findClose")}
        title={t("findClose")}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
})
