"use client"

import { useSyncExternalStore } from "react"

/**
 * keh4l build: how this device draws a conversation (Settings → Appearance →
 * Conversation). A display preference of this device only, like the chat
 * width and the animations switch — never synced to the server.
 *
 * - `view`: `compact` is the T3 Code style view (one "Worked for 1m 12s" line
 *   per finished reply, a single live row while the agent works); `timeline`
 *   is the upstream activity timeline.
 * - `toolVisibility`: which tool calls the compact view lists (T3's four
 *   levels). The timeline view always lists them all.
 * - `liveSpeed`: the compact view's working row adds the output speed.
 * - `minimap`: the compact view's timeline minimap on the thread's edge.
 */
export type ChatView = "compact" | "timeline"

export type ToolCallVisibility =
  | "showAll"
  | "hideSuccessful"
  | "hideAll"
  | "zen"

export const TOOL_CALL_VISIBILITIES: readonly ToolCallVisibility[] = [
  "showAll",
  "hideSuccessful",
  "hideAll",
  "zen",
]

export interface ChatViewPrefs {
  view: ChatView
  toolVisibility: ToolCallVisibility
  liveSpeed: boolean
  minimap: boolean
}

export const STORAGE_KEY_CHAT_VIEW_PREFS = "codeg-chat-view-prefs"

/**
 * The compact view is the default — except under the test runner, where the
 * upstream suites exercise the timeline view they were written for; the
 * compact view's own tests opt in with `writeChatViewPrefs`.
 */
function defaultPrefs(): ChatViewPrefs {
  return {
    view: process.env.NODE_ENV === "test" ? "timeline" : "compact",
    toolVisibility: "showAll",
    liveSpeed: false,
    minimap: true,
  }
}

function parsePrefs(raw: string | null): ChatViewPrefs {
  const prefs = defaultPrefs()
  if (!raw) return prefs
  try {
    const value = JSON.parse(raw) as Partial<
      Record<keyof ChatViewPrefs, unknown>
    >
    if (value.view === "compact" || value.view === "timeline") {
      prefs.view = value.view
    }
    if (
      typeof value.toolVisibility === "string" &&
      (TOOL_CALL_VISIBILITIES as readonly string[]).includes(
        value.toolVisibility
      )
    ) {
      prefs.toolVisibility = value.toolVisibility as ToolCallVisibility
    }
    if (typeof value.liveSpeed === "boolean") prefs.liveSpeed = value.liveSpeed
    if (typeof value.minimap === "boolean") prefs.minimap = value.minimap
  } catch {
    // A value this build cannot read keeps the defaults.
  }
  return prefs
}

function readStorage(): string | null {
  try {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(STORAGE_KEY_CHAT_VIEW_PREFS)
  } catch {
    return null
  }
}

let cachedRaw: string | null | undefined
let cached: ChatViewPrefs = defaultPrefs()
const listeners = new Set<() => void>()

/** The stored prefs, one object for as long as the stored value is the same. */
export function readChatViewPrefs(): ChatViewPrefs {
  const raw = readStorage()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cached = parsePrefs(raw)
  }
  return cached
}

export function writeChatViewPrefs(patch: Partial<ChatViewPrefs>): void {
  const next = { ...readChatViewPrefs(), ...patch }
  try {
    window.localStorage.setItem(
      STORAGE_KEY_CHAT_VIEW_PREFS,
      JSON.stringify(next)
    )
  } catch {
    // Storage full or blocked: the change lasts for this page only.
    cachedRaw = JSON.stringify(next)
    cached = next
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another window of this app changed them.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY_CHAT_VIEW_PREFS) {
      listener()
    }
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

const serverPrefs = defaultPrefs()

export function useChatViewPrefs(): ChatViewPrefs {
  return useSyncExternalStore(subscribe, readChatViewPrefs, () => serverPrefs)
}
