"use client"

/**
 * keh4l build: in a delete-conversation dialog, when the conversation is a
 * delegated sub-agent that worked in a worktree Codeg made for it
 * (`isolation: "worktree"`), offer to remove that worktree too. Checked by
 * default, unless it holds uncommitted changes. The dialog's confirm calls
 * {@link removeChosenDelegationWorktree} after the conversation is deleted.
 */

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Checkbox } from "@/components/ui/checkbox"
import { toErrorMessage } from "@/lib/app-error"
import {
  type DelegationWorktreeState,
  delegationWorktreeForConversation,
  removeDelegationWorktree,
} from "@/lib/delegation-worktree-api"

/** conversation id → the task whose worktree to remove with it. */
const chosen = new Map<number, string>()

export function DeleteConversationWorktreeOption({
  conversationId,
  open,
}: {
  conversationId: number | null | undefined
  open: boolean
}) {
  const t = useTranslations("DelegationWorktree")
  // What was found for which conversation: a closed dialog, or one for
  // another conversation, shows nothing.
  const [found, setFound] = useState<{
    conversationId: number
    state: DelegationWorktreeState | null
  } | null>(null)
  const [checked, setChecked] = useState(false)
  const active = open && conversationId != null && conversationId > 0
  const state =
    active && found?.conversationId === conversationId ? found.state : null

  useEffect(() => {
    if (!open || conversationId == null || conversationId <= 0) return
    let disposed = false
    delegationWorktreeForConversation(conversationId)
      .then((result) => {
        if (disposed) return
        setFound({ conversationId, state: result })
        setChecked(result ? result.uncommitted === 0 : false)
      })
      .catch(() => {
        if (!disposed) setFound({ conversationId, state: null })
      })
    return () => {
      disposed = true
    }
  }, [open, conversationId])

  useEffect(() => {
    if (conversationId == null) return
    if (state && checked) chosen.set(conversationId, state.task_id)
    else chosen.delete(conversationId)
  }, [conversationId, state, checked])

  if (!state) return null
  return (
    <label
      className="flex items-start gap-2 text-sm"
      data-testid="delete-conversation-worktree-option"
    >
      <Checkbox
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(v) => setChecked(v === true)}
      />
      <span className="min-w-0 break-all">
        {state.uncommitted > 0
          ? t("deleteWithConversationUncommitted", {
              path: state.path,
              count: state.uncommitted,
            })
          : t("deleteWithConversation", { path: state.path })}
      </span>
    </label>
  )
}

/** Remove the worktree the user chose to delete with `conversationId`. */
export async function removeChosenDelegationWorktree(
  conversationId: number
): Promise<void> {
  const taskId = chosen.get(conversationId)
  chosen.delete(conversationId)
  if (!taskId) return
  try {
    await removeDelegationWorktree(taskId, false, true)
  } catch (err) {
    toast.error(toErrorMessage(err))
  }
}
