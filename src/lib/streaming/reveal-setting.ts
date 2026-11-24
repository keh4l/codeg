// keh4l build: Settings → Appearance → "Smooth streaming text" — whether a
// streamed reply is paced over a bursty link (`reveal-pacer.ts`) or shown as
// it arrives. Per device (this browser's link), so in localStorage.

import { useSyncExternalStore } from "react"

export const STREAMING_REVEAL_STORAGE_KEY = "codeg-streaming-reveal"

/** `auto`: paced only while the link is bursty. `instant`: never paced. */
export type StreamingReveal = "auto" | "instant"

const listeners = new Set<() => void>()

export function readStreamingReveal(): StreamingReveal {
  try {
    return localStorage.getItem(STREAMING_REVEAL_STORAGE_KEY) === "instant"
      ? "instant"
      : "auto"
  } catch {
    return "auto"
  }
}

export function writeStreamingReveal(value: StreamingReveal): void {
  try {
    if (value === "auto") localStorage.removeItem(STREAMING_REVEAL_STORAGE_KEY)
    else localStorage.setItem(STREAMING_REVEAL_STORAGE_KEY, value)
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STREAMING_REVEAL_STORAGE_KEY) {
      listener()
    }
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function useStreamingReveal(): StreamingReveal {
  return useSyncExternalStore(subscribe, readStreamingReveal, () => "auto")
}
