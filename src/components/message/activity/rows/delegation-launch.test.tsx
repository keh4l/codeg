import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { DelegationLaunchFacts } from "@/lib/delegation-launch"
import type { DelegationWorktreeState } from "@/lib/delegation-worktree-api"

const getDelegationWorktree = vi.fn()
const removeDelegationWorktree = vi.fn()
vi.mock("@/lib/delegation-worktree-api", () => ({
  getDelegationWorktree: (...args: unknown[]) => getDelegationWorktree(...args),
  removeDelegationWorktree: (...args: unknown[]) =>
    removeDelegationWorktree(...args),
}))
const openWorktreeFolder = vi.fn()
vi.mock("@/lib/api", () => ({
  openWorktreeFolder: (...args: unknown[]) => openWorktreeFolder(...args),
}))
const openNewConversationTab = vi.fn()
vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({ openNewConversationTab }),
}))
const openConversations = vi.fn()
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openConversations }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import {
  DelegationLaunchChips,
  DelegationLaunchDetail,
} from "./delegation-launch"

const m = enMessages.Folder.chat.delegation.launch

function wrap(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

const worktreeFacts: DelegationLaunchFacts = {
  model: "gpt-6.2",
  config: { reasoning_effort: "high" },
  isolation: "worktree",
  worktree: {
    path: "/w/proj-delegate-9f3a1c22",
    branch: "delegate/9f3a1c22",
    base_sha: "abcdef0123456789",
  },
  round: 2,
}

function state(
  overrides: Partial<DelegationWorktreeState> = {}
): DelegationWorktreeState {
  return {
    task_id: "task-1",
    path: "/w/proj-delegate-9f3a1c22",
    branch: "delegate/9f3a1c22",
    base_sha: "abcdef0123456789",
    exists: true,
    removed: false,
    changes: "3 files changed, 1 commit",
    uncommitted: 0,
    working_dir: "/w/proj-delegate-9f3a1c22/app",
    source_folder_id: 7,
    ...overrides,
  }
}

beforeEach(() => {
  getDelegationWorktree.mockReset()
  removeDelegationWorktree.mockReset()
  openWorktreeFolder.mockReset()
  openNewConversationTab.mockReset()
  openConversations.mockReset()
})

describe("delegation launch chips", () => {
  it("shows the round, the model with its options, and the branch", () => {
    wrap(<DelegationLaunchChips facts={worktreeFacts} />)
    expect(screen.getByTestId("delegation-round-chip").textContent).toBe(
      m.round.replace("{round}", "2")
    )
    expect(screen.getByTestId("delegation-model-chip").textContent).toBe(
      "gpt-6.2 · high"
    )
    expect(screen.getByTestId("delegation-branch-chip").textContent).toBe(
      "delegate/9f3a1c22"
    )
  })

  it("shows nothing for a plain delegation", () => {
    const { container } = wrap(
      <DelegationLaunchChips
        facts={{
          model: null,
          config: {},
          isolation: "shared",
          worktree: null,
          round: null,
        }}
      />
    )
    expect(container.textContent).toBe("")
  })
})

describe("delegation launch detail", () => {
  it("opens the worktree in the workspace", async () => {
    getDelegationWorktree.mockResolvedValue(state())
    openWorktreeFolder.mockResolvedValue({ id: 42, path: "/w/x/app" })
    wrap(
      <DelegationLaunchDetail
        facts={worktreeFacts}
        taskId="task-1"
        running={false}
      />
    )
    await screen.findByText(/3 files changed, 1 commit/)
    await userEvent.click(screen.getByTestId("delegation-worktree-open"))
    await waitFor(() =>
      expect(openWorktreeFolder).toHaveBeenCalledWith(
        "/w/proj-delegate-9f3a1c22/app",
        7
      )
    )
    expect(openConversations).toHaveBeenCalled()
    expect(openNewConversationTab).toHaveBeenCalledWith(42, "/w/x/app")
  })

  it("can't remove the worktree while the task runs", async () => {
    getDelegationWorktree.mockResolvedValue(state())
    wrap(
      <DelegationLaunchDetail facts={worktreeFacts} taskId="task-1" running />
    )
    const remove = await screen.findByTestId("delegation-worktree-remove")
    expect((remove as HTMLButtonElement).disabled).toBe(true)
  })

  it("removes it after confirming, with the branch when asked", async () => {
    getDelegationWorktree
      .mockResolvedValueOnce(state({ uncommitted: 2 }))
      .mockResolvedValue(state({ exists: false, removed: true }))
    removeDelegationWorktree.mockResolvedValue({})
    wrap(
      <DelegationLaunchDetail
        facts={worktreeFacts}
        taskId="task-1"
        running={false}
      />
    )
    await userEvent.click(
      await screen.findByTestId("delegation-worktree-remove")
    )
    // The dialog warns about the uncommitted changes.
    await screen.findByText(
      m.removeUncommitted
        .replace("{count}", "2")
        .replace("{path}", "/w/proj-delegate-9f3a1c22")
    )
    await userEvent.click(screen.getByRole("checkbox"))
    await userEvent.click(screen.getByRole("button", { name: m.remove }))
    await waitFor(() =>
      expect(removeDelegationWorktree).toHaveBeenCalledWith(
        "task-1",
        true,
        true
      )
    )
    await screen.findByText(m.gone)
  })
})
