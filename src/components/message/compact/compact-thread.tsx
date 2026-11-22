"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import type { LiveMessage } from "@/contexts/acp-connections-context"

/**
 * keh4l build: what the compact view's replies need from the thread around
 * them.
 *
 * `round` is the current round's fold — positional, like upstream's
 * `ReplyFoldState.roundOpen` and for the same reason (a reply is renamed on
 * its way into history, so state keyed on it would drop the reader's choice
 * mid-read). The compact view folds a finished reply by default, so its round
 * starts shut each time the thread moves on to a new round (`roundKey`), and
 * opening it while the reply is written keeps it open once it is done.
 */
export interface CompactThreadValue {
  round: { open: boolean; setOpen: (open: boolean) => void }
  /** The reply the local connection is streaming, for the working row's
   *  clock and speed. Null for a passive viewer and between replies. */
  liveMessage: LiveMessage | null
  /** Put a sent message back in the composer to edit and send again. */
  onEditUserMessage?: (text: string) => void
}

const CompactThreadContext = createContext<CompactThreadValue | null>(null)

export function CompactThreadProvider({
  value,
  children,
}: {
  value: CompactThreadValue
  children: ReactNode
}) {
  return (
    <CompactThreadContext.Provider value={value}>
      {children}
    </CompactThreadContext.Provider>
  )
}

const NO_ROUND: CompactThreadValue = {
  round: { open: false, setOpen: () => {} },
  liveMessage: null,
}

export function useCompactThread(): CompactThreadValue {
  return useContext(CompactThreadContext) ?? NO_ROUND
}

/** The current round's fold, shut again whenever `roundKey` changes (a send,
 *  a new reply starting). Derived during render, so the send and the fold it
 *  causes land in one commit. */
export function useCompactRound(roundKey: string): CompactThreadValue["round"] {
  const [state, setState] = useState({ key: roundKey, open: false })
  if (state.key !== roundKey) setState({ key: roundKey, open: false })
  const open = state.key === roundKey ? state.open : false
  const setOpen = useCallback(
    (next: boolean) => setState({ key: roundKey, open: next }),
    [roundKey]
  )
  return useMemo(() => ({ open, setOpen }), [open, setOpen])
}

/**
 * Where the find bar is pointing: the query, and the turns holding the
 * current match. A compact reply among those turns unfolds, shows every step
 * whatever the visibility level, and opens the rows whose call holds the
 * query, so the match is on the page to be highlighted.
 */
export interface FindTarget {
  query: string
  caseSensitive: boolean
  turnIndex: number
  turnIds: ReadonlySet<string>
  /** Which part of the turn the match is in (the server's block kind). */
  block: string
  /** A new target each time the bar moves, even to the same turn. */
  token: number
}

let findTarget: FindTarget | null = null
const findListeners = new Set<() => void>()

export function setFindTarget(next: FindTarget | null): void {
  findTarget = next
  for (const listener of findListeners) listener()
}

function subscribeFind(listener: () => void) {
  findListeners.add(listener)
  return () => {
    findListeners.delete(listener)
  }
}

export function useFindTarget(): FindTarget | null {
  return useSyncExternalStore(
    subscribeFind,
    () => findTarget,
    () => null
  )
}
