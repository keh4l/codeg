// keh4l build: steer or queue while the agent replies
// (`src-tauri/src/acp/follow_up`). The queue lives on the server, so every
// window and device of one server sees the same one.

import { getTransport } from "@/lib/transport"
import type { PromptInputBlock } from "@/lib/types"

/** Broadcast with a {@link FollowUpQueueView} whenever a queue changes. */
export const FOLLOW_UP_QUEUE_CHANGED_EVENT = "follow-up://queue-changed"
/** Broadcast with `{ conversationId }` when a conversation's steers change. */
export const FOLLOW_UP_STEERS_CHANGED_EVENT = "follow-up://steers-changed"
/** Broadcast with a {@link FollowUpSteerUndelivered} after a stop. */
export const FOLLOW_UP_STEER_UNDELIVERED_EVENT = "follow-up://steer-undelivered"

export interface FollowUpQueueItem {
  id: string
  conversationId: number
  position: number
  text: string
  blocks: PromptInputBlock[]
  modeId: string | null
  adoptSendTimeMode: boolean
  createdAt: string
}

export interface FollowUpQueueView {
  conversationId: number
  items: FollowUpQueueItem[]
  /** Stopped or errored: nothing goes out until the user lets it go. */
  held: boolean
}

export interface FollowUpSteerRecord {
  id: string
  conversationId: number
  how: "native" | "restart"
  text: string
  status: "pending" | "sent" | "undelivered" | "requeued"
  createdAt: string
}

export interface FollowUpSteerUndelivered {
  conversationId: number | null
  connectionId: string
  steerId: string
  text: string
  blocks: PromptInputBlock[]
}

export type FollowUpSteerHow = "native" | "restart" | "queued" | "not_running"

export interface FollowUpSteerResult {
  how: FollowUpSteerHow
  steerId: string | null
  itemId: string | null
}

export function followUpSteer(args: {
  connectionId: string
  conversationId: number | null
  text: string
  blocks: PromptInputBlock[]
}): Promise<FollowUpSteerResult> {
  return getTransport().call("follow_up_steer", args)
}

export function followUpEnqueue(args: {
  conversationId: number
  connectionId: string | null
  text: string
  blocks: PromptInputBlock[]
  modeId: string | null
  adoptSendTimeMode: boolean
}): Promise<string> {
  return getTransport().call("follow_up_enqueue", args)
}

export function followUpList(
  conversationId: number
): Promise<FollowUpQueueView> {
  return getTransport().call("follow_up_list", { conversationId })
}

export function followUpUpdate(
  itemId: string,
  text: string,
  blocks: PromptInputBlock[]
): Promise<void> {
  return getTransport().call("follow_up_update", { itemId, text, blocks })
}

export function followUpRemove(itemId: string): Promise<void> {
  return getTransport().call("follow_up_remove", { itemId })
}

export function followUpReorder(
  conversationId: number,
  ids: string[]
): Promise<void> {
  return getTransport().call("follow_up_reorder", { conversationId, ids })
}

export function followUpResume(
  conversationId: number,
  connectionId: string | null
): Promise<void> {
  return getTransport().call("follow_up_resume", {
    conversationId,
    connectionId,
  })
}

export function followUpKick(
  conversationId: number,
  connectionId: string
): Promise<boolean> {
  return getTransport().call("follow_up_kick", { conversationId, connectionId })
}

export function followUpSendNow(
  itemId: string,
  connectionId: string
): Promise<FollowUpSteerResult> {
  return getTransport().call("follow_up_send_now", { itemId, connectionId })
}

export function followUpSteers(
  conversationId: number
): Promise<FollowUpSteerRecord[]> {
  return getTransport().call("follow_up_steers", { conversationId })
}
