// keh4l build: a conversation's timeline minimap list as the server last sent
// it, kept per conversation, so a remount, a reconnect or a page of older
// history loading in does not ask the server again.
//
// A list covers every turn before the window it was fetched for; it is fetched
// again only when the window starts later than that (turns it does not know
// sit between), or starts at the same turn over a different history (the
// window's `prefixHash` changed: the history before it was rewritten). The
// list comes from `get_conversation_minimap`, or with the conversation itself
// when the detail fetch asked for it (`api.ts` `getFolderConversation`).

import type { ConversationMinimapEntry } from "@/lib/transcript-view-api"

export interface CachedMinimap {
  entries: ConversationMinimapEntry[]
  offset: number
  prefixHash: string | null
}

const MAX_CACHED_MINIMAPS = 32
const minimapCache = new Map<number, CachedMinimap>()

/** The kept list, when it covers a window starting at `offset`. */
export function cachedMinimap(
  conversationId: number,
  offset: number,
  prefixHash: string | null
): ConversationMinimapEntry[] | null {
  const cached = minimapCache.get(conversationId)
  if (!cached) return null
  if (offset > cached.offset) return null
  if (offset === cached.offset && prefixHash !== cached.prefixHash) return null
  return cached.entries
}

/** Whether any list is kept for the conversation. */
export function hasCachedMinimap(conversationId: number): boolean {
  return minimapCache.has(conversationId)
}

export function rememberMinimap(conversationId: number, value: CachedMinimap) {
  minimapCache.delete(conversationId)
  minimapCache.set(conversationId, value)
  if (minimapCache.size > MAX_CACHED_MINIMAPS) {
    const oldest = minimapCache.keys().next().value
    if (oldest !== undefined) minimapCache.delete(oldest)
  }
}

/** @internal Test-only. */
export function __resetMinimapCacheForTests() {
  minimapCache.clear()
}
