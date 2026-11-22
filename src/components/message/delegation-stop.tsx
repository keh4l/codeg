"use client"

/**
 * keh4l build: stopping delegated sub-agents from the live-runs list — one at
 * a time on its row, or all of them from the group's heading. As the parent
 * agent's `cancel_delegation` would: the sub-agent stops and its result is
 * not handed back. The row leaves when the task's end arrives on the wire.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Square } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { toErrorMessage } from "@/lib/app-error"
import { stopDelegationTasks } from "@/lib/delegation-push-api"
import { cn } from "@/lib/utils"

const BUTTON = cn(
  "h-6 shrink-0 gap-1 px-2 text-xs",
  "text-muted-foreground hover:text-destructive"
)

function useStop(taskIds: readonly string[]) {
  const t = useTranslations("Folder.chat.liveRuns")
  const [busy, setBusy] = useState(false)
  const stop = async () => {
    if (busy || taskIds.length === 0) return
    setBusy(true)
    try {
      await stopDelegationTasks([...taskIds])
    } catch (err) {
      toast.error(t("stopFailed", { detail: toErrorMessage(err) }))
    } finally {
      setBusy(false)
    }
  }
  return { busy, stop }
}

/** On one delegation's row. */
export function DelegationStopButton({ taskId }: { taskId: string }) {
  const t = useTranslations("Folder.chat.liveRuns")
  const { busy, stop } = useStop([taskId])
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      className={BUTTON}
      onClick={() => void stop()}
      data-testid="delegation-stop"
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
      ) : (
        <Square aria-hidden="true" className="size-3" />
      )}
      {t("stop")}
    </Button>
  )
}

/** On the delegations' heading, when more than one can be stopped. */
export function DelegationStopAllButton({
  taskIds,
}: {
  taskIds: readonly string[]
}) {
  const t = useTranslations("Folder.chat.liveRuns")
  const { busy, stop } = useStop(taskIds)
  if (taskIds.length < 2) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      className={cn(BUTTON, "ms-auto -my-1 h-5")}
      onClick={() => void stop()}
      data-testid="delegation-stop-all"
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
      ) : (
        <Square aria-hidden="true" className="size-3" />
      )}
      {t("stopAll")}
    </Button>
  )
}
