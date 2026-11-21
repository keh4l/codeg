"use client"

/**
 * keh4l build: how a delegated task was launched, on its card — chips on the
 * title line (the model and options it ran with, the worktree branch, the
 * round of a continued task), and in the open panel the details with the
 * worktree's state and what can be done with it: open it in the workspace, or
 * remove it (nothing removes one on its own).
 */

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Cpu, FolderOpen, GitBranch, Repeat, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useTabActions } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { openWorktreeFolder } from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import type { ResolvedMessageGroup } from "@/components/message/message-list-view"
import {
  continuationRoundOf,
  launchChipLabel,
  type DelegationLaunchFacts,
} from "@/lib/delegation-launch"
import { firstTextOfParts } from "@/lib/task-rounds"
import {
  type DelegationWorktreeState,
  getDelegationWorktree,
  removeDelegationWorktree,
} from "@/lib/delegation-worktree-api"

const CHIP =
  "inline-flex max-w-[12rem] shrink-0 items-center gap-1 truncate rounded-sm border border-border/70 px-1 text-[0.75rem] leading-[1.125rem] text-activity-secondary"

export function DelegationLaunchChips({
  facts,
}: {
  facts: DelegationLaunchFacts
}) {
  const t = useTranslations("Folder.chat.delegation.launch")
  const label = launchChipLabel(facts)
  return (
    <>
      {facts.round ? (
        <span
          className={CHIP}
          data-testid="delegation-round-chip"
          title={t("roundHint", { round: facts.round })}
        >
          <Repeat className="size-3 shrink-0" aria-hidden="true" />
          {t("round", { round: facts.round })}
        </span>
      ) : null}
      {label ? (
        <span
          className={CHIP}
          title={label}
          data-testid="delegation-model-chip"
        >
          <Cpu className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
      ) : null}
      {facts.worktree ? (
        <span
          className={CHIP}
          title={facts.worktree.path}
          data-testid="delegation-branch-chip"
          dir="ltr"
        >
          <GitBranch className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono">{facts.worktree.branch}</span>
        </span>
      ) : facts.isolation === "worktree" ? (
        <span className={CHIP}>
          <GitBranch className="size-3 shrink-0" aria-hidden="true" />
          {t("worktree")}
        </span>
      ) : null}
    </>
  )
}

function useWorktreeState(taskId: string | null, enabled: boolean) {
  const [state, setState] = useState<DelegationWorktreeState | null>(null)
  const reload = useCallback(async () => {
    if (!taskId) return
    try {
      setState(await getDelegationWorktree(taskId))
    } catch {
      setState(null)
    }
  }, [taskId])
  useEffect(() => {
    if (!enabled || !taskId) return
    let disposed = false
    getDelegationWorktree(taskId)
      .then((found) => {
        if (!disposed) setState(found)
      })
      .catch(() => {
        if (!disposed) setState(null)
      })
    return () => {
      disposed = true
    }
  }, [enabled, taskId])
  return { state, reload }
}

export function DelegationLaunchDetail({
  facts,
  taskId,
  running,
}: {
  facts: DelegationLaunchFacts
  taskId: string | null
  /** The task still runs: its worktree cannot be removed. */
  running: boolean
}) {
  const t = useTranslations("Folder.chat.delegation.launch")
  const hasWorktree = facts.isolation === "worktree"
  const { state, reload } = useWorktreeState(taskId, hasWorktree)
  const { openNewConversationTab } = useTabActions()
  const { openConversations } = useWorkbenchRoute()
  const [confirming, setConfirming] = useState(false)
  const [deleteBranch, setDeleteBranch] = useState(false)
  const [busy, setBusy] = useState(false)
  const config = Object.entries(facts.config).filter(([key]) => key !== "model")
  const worktree = state ?? (facts.worktree ? { ...facts.worktree } : null)
  const gone = state ? !state.exists || state.removed : false

  const open = async () => {
    if (!state) return
    try {
      const detail = await openWorktreeFolder(
        state.working_dir ?? state.path,
        state.source_folder_id
      )
      openConversations()
      openNewConversationTab(detail.id, detail.path)
    } catch (err) {
      toast.error(t("openFailed", { detail: toErrorMessage(err) }))
    }
  }

  const remove = async () => {
    if (!taskId) return
    setBusy(true)
    try {
      await removeDelegationWorktree(taskId, deleteBranch, true)
      toast.success(t("removed"))
      await reload()
    } catch (err) {
      toast.error(t("removeFailed", { detail: toErrorMessage(err) }))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div
      className="flex flex-col gap-1.5 border-t px-4 py-3 text-xs"
      data-testid="delegation-launch-detail"
    >
      {facts.model ? (
        <div className="flex gap-2">
          <span className="w-20 shrink-0 text-activity-secondary">
            {t("model")}
          </span>
          <span className="min-w-0 break-all font-mono">{facts.model}</span>
        </div>
      ) : null}
      {config.length > 0 ? (
        <div className="flex gap-2">
          <span className="w-20 shrink-0 text-activity-secondary">
            {t("options")}
          </span>
          <span className="min-w-0 break-all font-mono">
            {config.map(([key, value]) => `${key}=${value}`).join(", ")}
          </span>
        </div>
      ) : null}
      {hasWorktree ? (
        <div className="flex gap-2">
          <span className="w-20 shrink-0 text-activity-secondary">
            {t("worktree")}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            {worktree ? (
              <>
                <span className="break-all font-mono" dir="ltr">
                  {worktree.path}
                </span>
                <span className="text-activity-secondary" dir="ltr">
                  {worktree.branch}
                  {worktree.base_sha
                    ? ` · ${t("from", { sha: worktree.base_sha.slice(0, 8) })}`
                    : ""}
                  {state?.changes ? ` · ${state.changes}` : ""}
                </span>
              </>
            ) : (
              <span className="text-activity-secondary">{t("pending")}</span>
            )}
            {gone ? (
              <span className="text-activity-secondary">{t("gone")}</span>
            ) : state ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void open()}
                  data-testid="delegation-worktree-open"
                >
                  <FolderOpen className="size-3" />
                  {t("open")}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={running || busy}
                  title={running ? t("removeRunning") : undefined}
                  onClick={() => {
                    setDeleteBranch(false)
                    setConfirming(true)
                  }}
                  data-testid="delegation-worktree-remove"
                >
                  <Trash2 className="size-3" />
                  {t("remove")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {state && state.uncommitted > 0
                ? t("removeUncommitted", {
                    count: state.uncommitted,
                    path: state.path,
                  })
                : t("removeDescription", { path: state?.path ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={deleteBranch}
              onCheckedChange={(v) => setDeleteBranch(v === true)}
            />
            {t("deleteBranch", { branch: state?.branch ?? "" })}
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                void remove()
              }}
            >
              {t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * For a sub-agent's transcript: label the prompts a `continue_delegation`
 * sent it — "Round 2 · follow-up from the main agent".
 */
export function useContinuationTurnHeader() {
  const t = useTranslations("Folder.chat.delegation.launch")
  return useCallback(
    (group: ResolvedMessageGroup) => {
      const round = continuationRoundOf(firstTextOfParts(group.parts))
      return round ? t("followUpHeader", { round }) : null
    },
    [t]
  )
}
