import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DbConversationSummary } from "@/lib/types"

const api = vi.hoisted(() => ({
  listAllConversations: vi.fn(),
  updateConversationTitle: vi.fn(),
  updateConversationStatus: vi.fn(),
  updateConversationPinned: vi.fn(),
  deleteConversation: vi.fn(),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}))

import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { __resetConversationHoldsForTests } from "@/stores/conversation-row-overlay"

import {
  deleteConversationNow,
  renameConversation,
  setConversationPinned,
  setConversationStatus,
} from "./conversation-actions"

function row(id: number, patch: Partial<DbConversationSummary> = {}) {
  return {
    id,
    folder_id: 1,
    parent_id: null,
    title: `Chat ${id}`,
    status: "in_progress",
    pinned_at: null,
    agent_type: "claude_code",
    message_count: 0,
    updated_at: "2026-11-24T00:00:00.000Z",
    ...patch,
  } as unknown as DbConversationSummary
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const rows = () => useAppWorkspaceStore.getState().conversations
const find = (id: number) => rows().find((c) => c.id === id)

beforeEach(() => {
  __resetConversationHoldsForTests()
  for (const fn of Object.values(api)) fn.mockReset()
  useAppWorkspaceStore.setState({ conversations: [row(1), row(2), row(3)] })
})
afterEach(() => {
  useAppWorkspaceStore.setState({ conversations: [] })
})

describe("instant conversation actions", () => {
  it("renames before the request, and keeps it over a stale list read", async () => {
    const request = deferred()
    api.updateConversationTitle.mockReturnValue(request.promise)
    const onError = vi.fn()
    const done = renameConversation(1, "New", onError)

    expect(find(1)?.title).toBe("New")
    // A list the server answered before the rename reached it.
    api.listAllConversations.mockResolvedValue([row(1), row(2), row(3)])
    await useAppWorkspaceStore.getState().refreshConversations()
    expect(find(1)?.title).toBe("New")

    request.resolve()
    expect(await done).toBe(true)
    expect(onError).not.toHaveBeenCalled()
    expect(api.updateConversationTitle).toHaveBeenCalledWith(1, "New", {
      retry: expect.objectContaining({ attempts: 2 }),
    })
  })

  it("takes a failed change back and reports it — unless the row moved on", async () => {
    api.updateConversationStatus.mockRejectedValue({
      code: "io_error",
      message: "disk full",
    })
    const onError = vi.fn()
    expect(await setConversationStatus(1, "completed", onError)).toBe(false)
    expect(find(1)?.status).toBe("in_progress")
    expect(onError).toHaveBeenCalledWith("disk full")

    // The server's broadcast replaced the row while the request was out.
    const request = deferred()
    api.updateConversationPinned.mockReturnValue(request.promise)
    const pin = setConversationPinned(2, true, vi.fn())
    const pinned = find(2)?.pinned_at
    expect(pinned).not.toBeNull()
    useAppWorkspaceStore
      .getState()
      .applyConversationUpsert(row(2, { pinned_at: "2026-11-24T01:00:00Z" }))
    request.reject(new Error("offline"))
    expect(await pin).toBe(false)
    expect(find(2)?.pinned_at).toBe("2026-11-24T01:00:00Z")
  })

  it("removes a deleted row and its tab at once, and puts the row back if the server refuses", async () => {
    const closeTab = vi.fn()
    const request = deferred()
    api.deleteConversation.mockReturnValue(request.promise)
    const onError = vi.fn()
    const done = deleteConversationNow(2, closeTab, onError)

    expect(rows().map((c) => c.id)).toEqual([1, 3])
    expect(closeTab).toHaveBeenCalledTimes(1)
    request.reject({ code: "io_error", message: "locked" })
    expect(await done).toBe(false)
    expect(rows().map((c) => c.id)).toEqual([1, 2, 3])
    expect(onError).toHaveBeenCalledWith("locked")
    // Its tombstone is gone too: the server's rows reach it again.
    useAppWorkspaceStore
      .getState()
      .applyConversationUpsert(row(2, { title: "Back" }))
    expect(find(2)?.title).toBe("Back")
  })

  it("counts a delete that finds nothing as done", async () => {
    api.deleteConversation.mockRejectedValue({
      code: "not_found",
      message: "gone",
    })
    const onError = vi.fn()
    expect(await deleteConversationNow(3, () => {}, onError)).toBe(true)
    expect(find(3)).toBeUndefined()
    expect(onError).not.toHaveBeenCalled()
  })
})
