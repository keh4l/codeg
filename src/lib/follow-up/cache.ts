// keh4l build: what a conversation's follow-up queue and steer records last
// were, so opening it again draws them without asking the server.
//
// Over a slow link each was a request on every open, competing with the
// conversation itself for the browser's six connections. The queue's
// broadcasts carry the whole view, so a kept view is replaced by each one; a
// steers broadcast says only which conversation changed, so it drops that
// conversation's records and the next open asks again. Nothing is kept from a
// read that started before both broadcasts were being received, and a
// transport reconnect (broadcasts sent while offline are lost) drops it all.
// Only over a network — where there is a reconnect to drop it on, and a round
// trip to save.

import {
  FOLLOW_UP_QUEUE_CHANGED_EVENT,
  FOLLOW_UP_STEERS_CHANGED_EVENT,
  followUpList,
  followUpSteers,
  type FollowUpQueueView,
  type FollowUpSteerRecord,
} from "@/lib/follow-up/api"
import {
  onTransportReconnect,
  subscribe as subscribePlatform,
} from "@/lib/platform"

const MAX_ENTRIES = 32

const queues = new Map<number, FollowUpQueueView>()
const steers = new Map<number, FollowUpSteerRecord[]>()
/** Bumped by every broadcast for a conversation and by every reconnect, so a
 *  read that overlapped one is not kept. */
const generations = new Map<number, number>()
let epoch = 0
/** `true` once the broadcasts and the reconnect hook are all in place. */
let listening = false
let starting = false

function remember<T>(map: Map<number, T>, id: number, value: T) {
  map.delete(id)
  map.set(id, value)
  if (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
}

function bump(id: number) {
  generations.set(id, (generations.get(id) ?? 0) + 1)
}

function stamp(id: number): string {
  return `${epoch}:${generations.get(id) ?? 0}`
}

function startListening() {
  if (listening || starting) return
  starting = true
  const stopReconnect = onTransportReconnect(() => {
    epoch += 1
    queues.clear()
    steers.clear()
  })
  if (!stopReconnect) {
    // No reconnect to hear (local desktop): nothing is kept.
    starting = false
    return
  }
  let pending = 2
  const ready = () => {
    pending -= 1
    if (pending === 0) listening = true
  }
  void subscribePlatform<FollowUpQueueView>(
    FOLLOW_UP_QUEUE_CHANGED_EVENT,
    (view) => {
      bump(view.conversationId)
      if (listening) remember(queues, view.conversationId, view)
    }
  )
    .then(ready)
    .catch(() => {})
  void subscribePlatform<{ conversationId: number }>(
    FOLLOW_UP_STEERS_CHANGED_EVENT,
    (payload) => {
      bump(payload.conversationId)
      steers.delete(payload.conversationId)
    }
  )
    .then(ready)
    .catch(() => {})
}

/** The kept queue view of a conversation, or `null` to ask the server. */
export function cachedFollowUpQueue(
  conversationId: number
): FollowUpQueueView | null {
  startListening()
  return listening ? (queues.get(conversationId) ?? null) : null
}

/** The kept steer records of a conversation, or `null` to ask the server. */
export function cachedFollowUpSteers(
  conversationId: number
): FollowUpSteerRecord[] | null {
  startListening()
  return listening ? (steers.get(conversationId) ?? null) : null
}

/** `followUpList`, keeping the answer for the next open. */
export async function loadFollowUpQueue(
  conversationId: number
): Promise<FollowUpQueueView> {
  startListening()
  const keep = listening
  const before = stamp(conversationId)
  const view = await followUpList(conversationId)
  if (keep && stamp(conversationId) === before) {
    remember(queues, conversationId, view)
  }
  return view
}

/** `followUpSteers`, keeping the answer for the next open. */
export async function loadFollowUpSteers(
  conversationId: number
): Promise<FollowUpSteerRecord[]> {
  startListening()
  const keep = listening
  const before = stamp(conversationId)
  const items = await followUpSteers(conversationId)
  if (keep && stamp(conversationId) === before) {
    remember(steers, conversationId, items)
  }
  return items
}

/** @internal Test-only. */
export function __resetFollowUpCacheForTests() {
  queues.clear()
  steers.clear()
  generations.clear()
  epoch = 0
  listening = false
  starting = false
}
