"use client"

/**
 * keh4l build: the panel of a `create_assistant` / `update_assistant` call —
 * the assistant as it is now, not as the call left it (an edit made since
 * shows), with the editor one click away — the same dialog Settings opens,
 * so a fix needs no trip there.
 *
 * Drawn from the assistants store, which every workspace window keeps live.
 * Renders nothing for an id this window has not seen; the card then shows the
 * call's reply instead.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Pencil } from "lucide-react"

import { AssistantAvatar } from "@/components/assistants/assistant-avatar"
import { AssistantEditorDialog } from "@/components/settings/assistant-editor-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getAgentLabel } from "@/lib/custom-agents"
import type { AssistantInfo } from "@/lib/types"
import { useAssistant } from "@/stores/assistants-store"

/** The saved picks as rows, read off the saved names: no agent is probed. */
function selectionRows(
  assistant: AssistantInfo,
  modeLabel: string,
  booleanLabels: { on: string; off: string }
): Array<{ name: string; value: string }> {
  const labels = assistant.label_snapshot
  const rows: Array<{ name: string; value: string }> = []
  if (labels.mode) rows.push({ name: modeLabel, value: labels.mode })
  for (const option of labels.options) {
    rows.push({
      name: option.name,
      value:
        option.kind === "boolean"
          ? assistant.agent_options.config_values?.[option.id] === "true"
            ? booleanLabels.on
            : booleanLabels.off
          : option.value_label,
    })
  }
  return rows
}

export function AssistantToolSummary({ assistantId }: { assistantId: number }) {
  const t = useTranslations("Folder.chat.codegMcpTool.assistant")
  const tm = useTranslations("AcpAgentSettings.multiAgent")
  const assistant = useAssistant(assistantId)
  const [editing, setEditing] = useState(false)

  if (!assistant) return null
  if (assistant.deleted_at !== null) {
    return (
      <div className="text-muted-foreground">
        {t("deleted", { name: assistant.name })}
      </div>
    )
  }

  const rows = selectionRows(assistant, tm("modeLabel"), {
    on: tm("booleanOn"),
    off: tm("booleanOff"),
  })
  const agent =
    getAgentLabel(assistant.agent_type) || assistant.label_snapshot.agent

  return (
    <div className="flex flex-col gap-2" data-testid="assistant-tool-summary">
      <div className="flex items-center gap-2">
        <AssistantAvatar
          avatar={assistant.avatar}
          name={assistant.name}
          size={28}
        />
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">
            {assistant.name}
          </div>
          <div className="truncate text-3xs text-muted-foreground">
            {assistant.enabled ? agent : t("switchedOff", { agent })}
          </div>
        </div>
      </div>
      {assistant.description ? (
        <div className="text-xs text-foreground/90">
          {assistant.description}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div>
          <div className="mb-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("options")}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {rows.map((row) => (
              <div key={row.name} className="contents">
                <dt className="text-muted-foreground">{row.name}</dt>
                <dd className="min-w-0 break-words text-foreground/90">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {assistant.instructions ? (
        <div>
          <div className="mb-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("instructions")}
          </div>
          {/* Plain pre-wrapped text, as the authoring cards show a prompt: it
              is what the agent will be handed, so it reads exactly as saved. */}
          <ScrollArea className="max-h-40 rounded-md bg-muted/40">
            <div className="whitespace-pre-wrap break-words px-2 py-1.5 text-xs text-foreground/90">
              {assistant.instructions}
            </div>
          </ScrollArea>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {t("edit")}
        </Button>
      </div>
      <AssistantEditorDialog
        open={editing}
        onOpenChange={setEditing}
        assistant={assistant}
      />
    </div>
  )
}
