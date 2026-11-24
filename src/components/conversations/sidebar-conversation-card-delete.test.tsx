// keh4l build: deleting from a sidebar row closes the dialog at once, and the
// delegation worktree the user chose to remove with it goes only once the
// conversation is deleted — the choice survives the dialog closing.

import { type ReactElement } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi, beforeEach } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { DbConversationSummary } from "@/lib/types"

const worktree = vi.hoisted(() => ({
  remove: vi.fn(async () => {}),
}))
vi.mock("@/components/agent-icon", () => ({ AgentIcon: () => null }))
vi.mock("@/lib/delegation-worktree-api", () => ({
  delegationWorktreeForConversation: async () => ({
    task_id: "task-9",
    path: "/repo/.worktrees/task-9",
    branch: "codeg/task-9",
    base_sha: "abc",
    exists: true,
    removed: false,
    changes: null,
    uncommitted: 0,
  }),
  removeDelegationWorktree: worktree.remove,
}))

import { SidebarConversationCard } from "./sidebar-conversation-card"

const conv: DbConversationSummary = {
  id: 7,
  folder_id: 1,
  title: "conv-7",
  title_locked: false,
  agent_type: "claude_code",
  status: "pending",
  kind: "regular",
  model: null,
  git_branch: null,
  external_id: null,
  message_count: 0,
  child_count: 0,
  created_at: "2026-11-24T00:00:00.000Z",
  updated_at: "2026-11-24T00:00:00.000Z",
  pinned_at: null,
}

function renderCard(onDelete: () => Promise<void>): ReactElement {
  const ui = (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SidebarConversationCard
        conversation={conv}
        isSelected={false}
        timeLabel=""
        onSelect={vi.fn()}
        onDoubleClick={vi.fn()}
        onRename={vi.fn(async () => {})}
        onDelete={onDelete}
        onStatusChange={vi.fn(async () => {})}
      />
    </NextIntlClientProvider>
  )
  render(ui)
  return ui
}

async function confirmDelete() {
  fireEvent.contextMenu(screen.getByText("conv-7"))
  fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }))
  await screen.findByTestId("delete-conversation-worktree-option")
  fireEvent.click(screen.getByRole("button", { name: "Delete" }))
}

beforeEach(() => worktree.remove.mockClear())

describe("SidebarConversationCard delete", () => {
  it("removes the chosen worktree once the conversation is deleted", async () => {
    let finish!: () => void
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    renderCard(onDelete)
    await confirmDelete()

    expect(onDelete).toHaveBeenCalledWith(7, "claude_code", 1)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(worktree.remove).not.toHaveBeenCalled()
    finish()
    await waitFor(() =>
      expect(worktree.remove).toHaveBeenCalledWith("task-9", false, true)
    )
  })

  it("keeps the worktree when the delete fails", async () => {
    const onDelete = vi.fn(() => Promise.reject(new Error("refused")))
    renderCard(onDelete)
    await confirmDelete()
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(worktree.remove).not.toHaveBeenCalled()
  })
})
