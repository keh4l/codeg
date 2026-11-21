/**
 * keh4l build: live state for delegation results Codeg hands back to a parent
 * agent (`acp::delegation::delivery` in the backend), outside React and the
 * conversation runtime store:
 *
 * - results that rode along with a user message, by that message's id, until
 *   the reloaded transcript carries them on the persisted turn;
 * - whether Codeg is holding a parent connection's results for the next
 *   prompt instead of waking it (`delegation_push_held`).
 */

import type { DelegationResultsMode, DelegationResultsTask } from "@/lib/types"

export interface LiveAttachedResults {
  id: string
  mode: DelegationResultsMode
  tasks: DelegationResultsTask[]
}

type Listener = () => void

const attachedByMessageId = new Map<string, LiveAttachedResults>()
const heldByConnectionId = new Map<string, boolean>()
const listeners = new Set<Listener>()
/** How many attached batches to remember: a session's worth. */
const MAX_ATTACHED = 200

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeDelegationResultsLive(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function recordAttachedResults(
  messageId: string,
  results: LiveAttachedResults
): void {
  if (attachedByMessageId.get(messageId)?.id === results.id) return
  attachedByMessageId.set(messageId, results)
  while (attachedByMessageId.size > MAX_ATTACHED) {
    const oldest = attachedByMessageId.keys().next().value
    if (oldest === undefined) break
    attachedByMessageId.delete(oldest)
  }
  emit()
}

export function attachedResultsFor(
  messageIds: readonly string[] | undefined
): LiveAttachedResults | null {
  if (!messageIds) return null
  for (const id of messageIds) {
    const found = attachedByMessageId.get(id)
    if (found) return found
  }
  return null
}

export function setDelegationPushHeld(
  connectionId: string,
  held: boolean
): void {
  if ((heldByConnectionId.get(connectionId) ?? false) === held) return
  if (held) heldByConnectionId.set(connectionId, true)
  else heldByConnectionId.delete(connectionId)
  emit()
}

export function isDelegationPushHeld(connectionId: string | null): boolean {
  return connectionId ? (heldByConnectionId.get(connectionId) ?? false) : false
}

/** For tests. */
export function resetDelegationResultsLive(): void {
  attachedByMessageId.clear()
  heldByConnectionId.clear()
  emit()
}
