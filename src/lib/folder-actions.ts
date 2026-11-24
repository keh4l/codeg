// keh4l build: a folder's colour, alias and default agent change at once.
//
// Each used to wait for its update and then read the folder again — two round
// trips before the sidebar changed, though the update already answers with
// the whole folder. Now the folder changes first, the update's answer is
// applied as it comes (unless a newer change of the same field has started
// meanwhile), and a change that finally fails is taken back — when the folder
// still shows it — and reported through `onError`.

import { toErrorMessage } from "@/lib/app-error"
import {
  updateFolderAlias,
  updateFolderColor,
  updateFolderDefaultAgent,
} from "@/lib/api"
import { runOptimistic } from "@/lib/optimistic-action"
import type { FolderThemeColor } from "@/lib/theme-presets"
import type { AgentType, FolderDetail } from "@/lib/types"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"

type Field = "color" | "alias" | "default_agent_type"

/** Patch a folder where it is listed, without listing it anywhere new (as
 *  `refreshFolder` does). */
function patchFolder(id: number, patch: Partial<FolderDetail>): void {
  const { folders, allFolders } = useAppWorkspaceStore.getState()
  const edit = (list: FolderDetail[]) => {
    const index = list.findIndex((f) => f.id === id)
    if (index < 0) return list
    const next = list.slice()
    next[index] = { ...next[index]!, ...patch }
    return next
  }
  useAppWorkspaceStore.setState({
    folders: edit(folders),
    allFolders: edit(allFolders),
  })
}

const folderOf = (id: number) =>
  useAppWorkspaceStore.getState().allFolders.find((f) => f.id === id) ??
  useAppWorkspaceStore.getState().folders.find((f) => f.id === id)

async function changeFolder<F extends Field>(
  id: number,
  field: F,
  value: FolderDetail[F],
  send: () => Promise<FolderDetail>,
  onError: (message: string) => void
): Promise<boolean> {
  const before = folderOf(id)
  const outcome = await runOptimistic({
    key: `folder:${id}:${field}`,
    apply: () => {
      patchFolder(id, { [field]: value })
      return () => {
        if (before && folderOf(id)?.[field] === value) {
          patchFolder(id, { [field]: before[field] })
        }
      }
    },
    commit: async (stillWanted) => {
      const detail = await send()
      if (stillWanted()) patchFolder(id, detail)
    },
    onError: (error) => onError(toErrorMessage(error)),
  })
  return outcome.status !== "failed"
}

export function changeFolderColor(
  id: number,
  color: FolderThemeColor,
  onError: (message: string) => void
): Promise<boolean> {
  return changeFolder(
    id,
    "color",
    color,
    () => updateFolderColor(id, color),
    onError
  )
}

export function setFolderAlias(
  id: number,
  alias: string | null,
  onError: (message: string) => void
): Promise<boolean> {
  return changeFolder(
    id,
    "alias",
    alias,
    () => updateFolderAlias(id, alias),
    onError
  )
}

export function changeFolderDefaultAgent(
  id: number,
  agentType: AgentType | null,
  onError: (message: string) => void
): Promise<boolean> {
  return changeFolder(
    id,
    "default_agent_type",
    agentType,
    () => updateFolderDefaultAgent(id, agentType),
    onError
  )
}
