// keh4l build: the "Create assistants" switch (`create_assistant` /
// `update_assistant`). It has no endpoint of its own: it is the `assistants`
// group of the codeg-mcp tool groups, read off the service status and written
// through the same writer the status-bar popover uses
// (`src-tauri/src/assistant_tools/mod.rs`).

import { getCodegMcpServiceStatus, setCodegMcpToolGroup } from "@/lib/api"

/** The group's `--features` slug, as the backend reports it. */
export const ASSISTANT_TOOLS_GROUP = "assistants"

/** Broadcast after the switch changes, carrying {@link AssistantToolsSettings}. */
export const ASSISTANT_TOOLS_SETTINGS_CHANGED_EVENT =
  "assistant-tools-settings://changed"

export interface AssistantToolsSettings {
  enabled: boolean
}

export async function getAssistantToolsSettings(): Promise<AssistantToolsSettings> {
  const status = await getCodegMcpServiceStatus()
  const group = status.tool_groups.find((g) => g.key === ASSISTANT_TOOLS_GROUP)
  // Absent only from a backend without the tools; the switch's default is on.
  return { enabled: group?.enabled ?? true }
}

export async function setAssistantToolsEnabled(
  enabled: boolean
): Promise<AssistantToolsSettings> {
  await setCodegMcpToolGroup(ASSISTANT_TOOLS_GROUP, enabled)
  return { enabled }
}
