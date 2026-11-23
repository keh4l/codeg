// keh4l build: re-reads a window focus triggers, kept from piling up over a
// network.
//
// Several lists re-read themselves on every window focus, so an alt-tab sent
// a burst of requests (the agents list among them, ~10 KB with every agent's
// settings). On the local desktop that is free, and it is how agent CLIs or
// skills installed outside the app show up, so it stays. Over a network the
// server announces its own changes, and a reconnect re-reads everything, so a
// focus re-reads at most once per `NETWORK_FOCUS_REFRESH_MS`.

import { isLocalDesktop } from "@/lib/platform"

export const NETWORK_FOCUS_REFRESH_MS = 5 * 60 * 1000

/** `read`, as a focus handler: every call on the local desktop, at most one
 *  per `intervalMs` (counted from now) otherwise. */
export function focusRefresh(
  read: () => void,
  intervalMs = NETWORK_FOCUS_REFRESH_MS
): () => void {
  let last = Date.now()
  return () => {
    if (!isLocalDesktop()) {
      const now = Date.now()
      if (now - last < intervalMs) return
      last = now
    }
    read()
  }
}
