// Where a window keeps its open conversation tabs while cross-client tab sync
// is off (see `tab-sync-prefs.ts`) — the window-local stand-in for the shared
// `opened_tabs` table.
//
// sessionStorage is the window's own copy: one per browser tab or webview, it
// survives a reload and a reconnect, and no other window can read or overwrite
// it. That is exactly the scope "this window's tabs" needs. A duplicated
// browser tab starts from a copy of it and diverges from there.
//
// Every write is mirrored to localStorage as "the most recent window's tabs",
// which only a window with no sessionStorage copy reads — a new tab, a reopened
// browser, a desktop relaunch — so it starts where the user last was instead
// of blank. That copy is keyed by window label because the desktop
// remote-workspace windows share this origin but talk to other backends.
//
// The split-group blob gets a sessionStorage copy too (`tab-store` falls back
// to the shared localStorage blob when there is none), so a window's layout
// stops being overwritten by whichever same-origin window saved last.

import { getCurrentWindowLabel } from "@/lib/browser/window-label"
import type { OpenedTab } from "@/lib/types"

const TABS_KEY = "workspace:window-tabs:v1"
const LAST_TABS_KEY_PREFIX = "workspace:window-tabs:last:v1:"
const GROUPS_KEY = "workspace:window-tab-groups:v1"

function lastTabsKey(): string {
  return `${LAST_TABS_KEY_PREFIX}${getCurrentWindowLabel()}`
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value)
}

/** Keep only well-formed conversation tabs; a corrupt entry is dropped rather
 *  than taking the whole list with it. */
function sanitizeTabs(raw: unknown): OpenedTab[] | null {
  if (!Array.isArray(raw)) return null
  const out: OpenedTab[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const it = entry as Record<string, unknown>
    if (!isInt(it.folder_id) || !isInt(it.conversation_id)) continue
    if (typeof it.agent_type !== "string" || it.agent_type === "") continue
    out.push({
      id: 0,
      folder_id: it.folder_id,
      conversation_id: it.conversation_id,
      agent_type: it.agent_type as OpenedTab["agent_type"],
      position: out.length,
      is_active: it.is_active === true,
      is_pinned: it.is_pinned === true,
    })
  }
  return out
}

function readTabsFrom(storage: Storage, key: string): OpenedTab[] | null {
  const raw = storage.getItem(key)
  if (raw == null) return null
  try {
    return sanitizeTabs(JSON.parse(raw))
  } catch {
    return null
  }
}

/** This window's stored tabs, else the most recent window's, else `null`. */
export function readWindowTabs(): OpenedTab[] | null {
  if (typeof window === "undefined") return null
  try {
    return (
      readTabsFrom(sessionStorage, TABS_KEY) ??
      readTabsFrom(localStorage, lastTabsKey())
    )
  } catch {
    return null
  }
}

export function writeWindowTabs(items: OpenedTab[]): void {
  if (typeof window === "undefined") return
  const blob = JSON.stringify(items.filter((it) => it.conversation_id != null))
  try {
    sessionStorage.setItem(TABS_KEY, blob)
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(lastTabsKey(), blob)
  } catch {
    /* ignore */
  }
}

/** This window's own split-group blob (no fallback — the caller has one). */
export function readWindowGroupBlob(): string | null {
  if (typeof window === "undefined") return null
  try {
    return sessionStorage.getItem(GROUPS_KEY)
  } catch {
    return null
  }
}

export function writeWindowGroupBlob(blob: string): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(GROUPS_KEY, blob)
  } catch {
    /* ignore */
  }
}
