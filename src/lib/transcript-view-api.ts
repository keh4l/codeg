// keh4l build: whole-transcript find and minimap for the T3-style chat view
// (`src-tauri/src/commands/transcript_view.rs`). Both read the conversation's
// FULL turn list — the one `turns_offset` / `loadOlderTurnsThrough` index —
// so `turn_index` is a global turn index and `turn_id` that turn's id.

import type { TurnRole } from "@/lib/types"
import { getTransport } from "@/lib/transport"

/** Where in a turn a match was found. */
export type ConversationSearchBlock =
  | "text"
  | "thinking"
  | "tool_input"
  | "tool_output"

export interface ConversationSearchMatch {
  /** Index into the conversation's full turn list. */
  turn_index: number
  turn_id: string
  role: TurnRole
  block: ConversationSearchBlock
  /** 0-based index of this occurrence among the query's occurrences in the
   *  same turn's blocks of the same kind, in document order (it runs on
   *  across a turn's several text blocks). Case-insensitive matching folds
   *  one character at a time (`Array.from(s, (c) => c.toLowerCase())`), so a
   *  recount must fold the same way. */
  occurrence: number
  /** The match with up to 40 characters of context on each side, whitespace
   *  runs collapsed to one space, "…" where cut. */
  snippet: string
  /** Code point offsets (NOT UTF-16 indexes) of the match inside `snippet`,
   *  end exclusive: slice `Array.from(snippet)` with them. */
  snippet_match_start: number
  snippet_match_end: number
}

export interface ConversationSearchResult {
  /** The first `limit` occurrences, in turn order then block order. */
  matches: ConversationSearchMatch[]
  /** Every occurrence in the transcript, returned or not. */
  total: number
  truncated: boolean
}

export interface ConversationMinimapEntry {
  /** Index into the conversation's full turn list. */
  turn_index: number
  turn_id: string
  /** RFC 3339 timestamp of the user turn. */
  timestamp: string
  /** The user's first non-empty text, whitespace collapsed, ≤160 chars + "…". */
  prompt: string
  /** The last non-empty assistant text before the next user message,
   *  whitespace collapsed, ≤240 chars + "…"; null when nothing answered. */
  reply: string | null
}

export interface SearchConversationOptions {
  caseSensitive?: boolean
  /** Matches to return (default 1000, capped at 5000); `total` counts all. */
  limit?: number
}

/** Full-text search over the whole transcript, not just the loaded window. */
export async function searchConversation(
  conversationId: number,
  query: string,
  { caseSensitive = false, limit }: SearchConversationOptions = {}
): Promise<ConversationSearchResult> {
  return getTransport().call("search_conversation", {
    conversationId,
    query,
    caseSensitive,
    limit: limit ?? null,
  })
}

/** One entry per user message of the whole conversation, in order. */
export async function getConversationMinimap(
  conversationId: number
): Promise<ConversationMinimapEntry[]> {
  return getTransport().call("get_conversation_minimap", { conversationId })
}
