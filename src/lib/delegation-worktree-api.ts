// keh4l build: the worktrees `delegate_to_agent` made with
// `isolation: "worktree"` (`src-tauri/src/commands/delegation_worktree.rs`).

import type { GitWorktreeRemoval } from "@/lib/types"
import { getTransport } from "@/lib/transport"

export interface DelegationWorktreeState {
  task_id: string
  path: string
  branch: string
  base_sha: string
  /** The directory is still there. */
  exists: boolean
  /** Removed through Codeg. */
  removed: boolean
  /** "3 files changed, 1 commit, 1 uncommitted". */
  changes: string | null
  /** Uncommitted entries in it now. */
  uncommitted: number
  /** Where the child started in it — the folder Codeg registered for it. */
  working_dir: string | null
  /** The parent conversation's folder. */
  source_folder_id: number
}

export async function getDelegationWorktree(
  taskId: string
): Promise<DelegationWorktreeState | null> {
  return getTransport().call("get_delegation_worktree", { taskId })
}

export async function delegationWorktreeForConversation(
  conversationId: number
): Promise<DelegationWorktreeState | null> {
  return getTransport().call("delegation_worktree_for_conversation", {
    conversationId,
  })
}

export async function removeDelegationWorktree(
  taskId: string,
  deleteBranch: boolean,
  force = false
): Promise<GitWorktreeRemoval> {
  return getTransport().call("remove_delegation_worktree", {
    taskId,
    deleteBranch,
    force,
  })
}
