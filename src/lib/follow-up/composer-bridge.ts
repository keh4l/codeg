"use client"

/**
 * keh4l build: what the conversation panel lends its composer for the queue
 * shortcuts (steer the oldest queued message, edit the latest one), keyed by
 * tab. A bridge rather than props so the composer needs no new prop threaded
 * through the (upstream) shell and input wrappers.
 */

import { useSyncExternalStore } from "react"

export interface FollowUpComposerBridge {
  /** Steer the oldest queued message into the running turn. */
  steerOldest?: () => void
  /** Load the latest queued message into the composer for editing. */
  editLatest?: () => void
  /** Let a held queue go (Enter in an empty composer). */
  resumeHeld?: () => void
}

const EMPTY: FollowUpComposerBridge = {}
const values = new Map<string, FollowUpComposerBridge>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function setFollowUpComposerBridge(
  tabId: string,
  value: FollowUpComposerBridge | null
): void {
  if (value) values.set(tabId, value)
  else values.delete(tabId)
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useFollowUpComposerBridge(
  tabId: string | null | undefined
): FollowUpComposerBridge {
  return useSyncExternalStore(
    subscribe,
    () => (tabId ? (values.get(tabId) ?? EMPTY) : EMPTY),
    () => EMPTY
  )
}
