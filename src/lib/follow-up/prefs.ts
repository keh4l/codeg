"use client"

/**
 * keh4l build: what the send key does while the agent is replying — steer
 * into the running turn (the default, as in T3 Code) or queue for after it.
 * Per device, like T3: it is a habit of the person at this keyboard, not a
 * property of the server.
 */

import { useSyncExternalStore } from "react"

import {
  DEFAULT_FOLLOW_UP_BEHAVIOR,
  type FollowUpBehavior,
  isFollowUpBehavior,
} from "./dispatch-mode"

const PREFS_KEY = "settings:follow-up:v1"
const PREFS_EVENT = "codeg:follow-up-changed"

function load(): FollowUpBehavior {
  if (typeof window === "undefined") return DEFAULT_FOLLOW_UP_BEHAVIOR
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_FOLLOW_UP_BEHAVIOR
    const parsed: unknown = JSON.parse(raw)
    const behavior =
      parsed && typeof parsed === "object"
        ? (parsed as { behavior?: unknown }).behavior
        : undefined
    return isFollowUpBehavior(behavior) ? behavior : DEFAULT_FOLLOW_UP_BEHAVIOR
  } catch {
    return DEFAULT_FOLLOW_UP_BEHAVIOR
  }
}

let snapshot: FollowUpBehavior | null = null
const listeners = new Set<() => void>()
let windowBound = false

function bindWindow(): void {
  if (windowBound || typeof window === "undefined") return
  windowBound = true
  const invalidate = () => {
    snapshot = null
    for (const listener of listeners) listener()
  }
  window.addEventListener(PREFS_EVENT, invalidate)
  window.addEventListener("storage", invalidate)
}

export function getFollowUpBehavior(): FollowUpBehavior {
  bindWindow()
  if (typeof window === "undefined") return DEFAULT_FOLLOW_UP_BEHAVIOR
  snapshot ??= load()
  return snapshot
}

export function saveFollowUpBehavior(behavior: FollowUpBehavior): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ behavior }))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT))
}

function subscribe(onChange: () => void): () => void {
  bindWindow()
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function useFollowUpBehavior(): FollowUpBehavior {
  return useSyncExternalStore(
    subscribe,
    getFollowUpBehavior,
    () => DEFAULT_FOLLOW_UP_BEHAVIOR
  )
}

/** Test seam: forget the memoized value so the next read hits storage. */
export function resetFollowUpBehaviorCacheForTests(): void {
  snapshot = null
}
