// Whether this client's open conversation tabs (and the focused one) follow
// the workspace-wide set every client of the backend shares — `opened_tabs`,
// kept converged over `tabs://changed` — or belong to the window alone.
//
// Per client (localStorage), not per backend: it describes how this browser or
// app is being used, and two clients of one server may well want different
// things. Only the open-tab UI state is affected; conversations, messages, run
// status and real deletions reach every window either way.
//
// Default: on in the desktop app, which has one workspace window per backend
// and uses the shared set to hand work over to a browser elsewhere; off in a
// browser, where several windows on one server is how parallel tasks are run
// and a shared set makes every window follow whichever one moved last.

import { useEffect, useState } from "react"
import { detectEnvironment } from "@/lib/transport/detect"

const TAB_SYNC_KEY = "workspace:tab-sync"
const TAB_SYNC_EVENT = "codeg:tab-sync-changed"

export function defaultTabSyncEnabled(): boolean {
  return detectEnvironment() === "tauri"
}

export function loadTabSyncEnabled(): boolean {
  if (typeof window === "undefined") return true
  try {
    const raw = localStorage.getItem(TAB_SYNC_KEY)
    if (raw === "true") return true
    if (raw === "false") return false
  } catch {
    /* fall through to the default */
  }
  return defaultTabSyncEnabled()
}

export function saveTabSyncEnabled(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(TAB_SYNC_KEY, String(value))
  } catch {
    /* ignore */
  }
  // Same-window listeners (settings and workspace may share a window) hear the
  // custom event; other windows get the native `storage` event.
  window.dispatchEvent(new CustomEvent(TAB_SYNC_EVENT, { detail: value }))
}

/**
 * Reactive read of the preference, live across windows — flipping it in the
 * Settings window switches every open workspace window without a reload.
 */
export function useTabSyncEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(loadTabSyncEnabled)
  useEffect(() => {
    const sync = () => setEnabled(loadTabSyncEnabled())
    window.addEventListener(TAB_SYNC_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(TAB_SYNC_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])
  return enabled
}
