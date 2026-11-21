"use client"

/**
 * keh4l build: whether finished delegations are pushed back to the parent
 * (the server-side switch in `@/lib/delegation-push-api`), read once per page
 * and followed across clients. `true` until the first answer: the default.
 */

import { useSyncExternalStore } from "react"

import {
  DELEGATION_PUSH_SETTINGS_CHANGED_EVENT,
  type DelegationPushSettings,
  getDelegationPushSettings,
} from "@/lib/delegation-push-api"
import { subscribe as subscribePlatform } from "@/lib/platform"

let enabled = true
let started = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (next === enabled) return
  enabled = next
  for (const listener of listeners) listener()
}

function start() {
  if (started) return
  started = true
  // Best effort: without an answer the chip keeps the default.
  try {
    getDelegationPushSettings()
      .then((s) => set(s.enabled))
      .catch(() => {})
    void subscribePlatform<DelegationPushSettings>(
      DELEGATION_PUSH_SETTINGS_CHANGED_EVENT,
      (remote) => set(remote.enabled)
    ).catch(() => {})
  } catch {
    // No transport (a test, or a surface outside the app).
  }
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDelegationPushEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => enabled,
    () => true
  )
}
