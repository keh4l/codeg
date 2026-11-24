// keh4l build: renaming, pinning, marking and deleting a conversation show at
// once.
//
// Each used to wait for its request — a rename kept its dialog open, a delete
// left the row in place — and then re-read the whole conversation list,
// which the server's own broadcast (`conversation://changed`) already brings.
// Now the row changes first; the change is held over list reads until the
// server confirms it (`conversation-row-overlay.ts`), the request is sent
// again on a network failure while it is still the latest for that row
// (`optimistic-action.ts`), and a change that finally fails is taken back —
// when the row still shows it — and reported through `onError`.

import { isNotFoundError, toErrorMessage } from "@/lib/app-error"
import {
  deleteConversation,
  updateConversationPinned,
  updateConversationStatus,
  updateConversationTitle,
} from "@/lib/api"
import { retryWhile, runOptimistic } from "@/lib/optimistic-action"
import type { CallOptions } from "@/lib/transport/types"
import type { DbConversationSummary } from "@/lib/types"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import {
  holdConversationField,
  type ConversationFieldHold,
} from "@/stores/conversation-row-overlay"

/** Told the server's error message when a change finally fails. */
export type ConversationActionError = (message: string) => void

type Field = "title" | "status" | "pinned_at"

const rowOf = (id: number) =>
  useAppWorkspaceStore.getState().conversations.find((c) => c.id === id)

async function changeField<F extends Field>(
  id: number,
  field: F,
  value: DbConversationSummary[F],
  send: (options: CallOptions) => Promise<void>,
  onError: ConversationActionError
): Promise<boolean> {
  const before = rowOf(id)
  let hold: ConversationFieldHold | null = null
  const outcome = await runOptimistic({
    key: `conversation:${id}:${field}`,
    apply: () => {
      useAppWorkspaceStore.getState().updateConversationLocal(id, {
        [field]: value,
      })
      hold = holdConversationField(id, field, value)
      return () => {
        hold?.release()
        const now = rowOf(id)
        if (before && now && now[field] === value) {
          useAppWorkspaceStore.getState().updateConversationLocal(id, {
            [field]: before[field],
          })
        }
      }
    },
    commit: async (stillWanted) => {
      await send(retryWhile(stillWanted))
      hold?.settle()
    },
    onError: (error) => onError(toErrorMessage(error)),
  })
  return outcome.status !== "failed"
}

export function renameConversation(
  id: number,
  title: string,
  onError: ConversationActionError
): Promise<boolean> {
  return changeField(
    id,
    "title",
    title,
    (options) => updateConversationTitle(id, title, options),
    onError
  )
}

export function setConversationStatus(
  id: number,
  status: string,
  onError: ConversationActionError
): Promise<boolean> {
  return changeField(
    id,
    "status",
    status,
    (options) => updateConversationStatus(id, status, options),
    onError
  )
}

export function setConversationPinned(
  id: number,
  pinned: boolean,
  onError: ConversationActionError
): Promise<boolean> {
  return changeField(
    id,
    "pinned_at",
    pinned ? new Date().toISOString() : null,
    (options) => updateConversationPinned(id, pinned, options),
    onError
  )
}

/**
 * Remove the row and run `closeTab` at once, then delete on the server.
 * Resolves `true` once the server has deleted it (a repeated delete that
 * finds nothing counts); on failure the row comes back where it was (its tab
 * does not reopen) and `onError` is told.
 */
export async function deleteConversationNow(
  id: number,
  closeTab: () => void,
  onError: ConversationActionError
): Promise<boolean> {
  const outcome = await runOptimistic({
    key: `conversation:${id}:delete`,
    apply: () => {
      const store = useAppWorkspaceStore.getState()
      const before = rowOf(id)
      const index = before ? store.conversations.indexOf(before) : -1
      store.applyConversationRemove(id)
      closeTab()
      return () => {
        if (before) {
          useAppWorkspaceStore.getState().restoreConversation(before, index)
        }
      }
    },
    commit: (stillWanted) => deleteConversation(id, retryWhile(stillWanted)),
    isAlreadyDone: isNotFoundError,
    onError: (error) => onError(toErrorMessage(error)),
  })
  return outcome.status === "done"
}
