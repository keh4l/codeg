import { beforeEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"

import type { DbConversationDetail, MessageTurn } from "@/lib/types"

vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(),
}))

const { getFolderConversation } = await import("@/lib/api")
const mockGetFolderConversation = vi.mocked(getFolderConversation)
const { resetConversationRuntimeStore, useConversationRuntimeStore } =
  await import("@/stores/conversation-runtime-store")

function turn(id: string): MessageTurn {
  return {
    id,
    role: "user",
    blocks: [{ type: "text", text: id }],
    timestamp: "2026-07-13T00:00:00.000Z",
  }
}

function detail(
  turns: MessageTurn[],
  hasOlder: boolean,
  cursor: number | null
): DbConversationDetail {
  return {
    summary: {
      id: 7,
      folder_id: 1,
      title: "large history",
      title_locked: false,
      agent_type: "codex",
      status: "completed",
      kind: "regular",
      model: null,
      git_branch: null,
      external_id: "ext-7",
      message_count: 250,
      child_count: 0,
      created_at: "2026-07-13T00:00:00.000Z",
      updated_at: "2026-07-13T00:00:00.000Z",
      pinned_at: null,
    },
    turns,
    has_older_turns: hasOlder,
    older_turns_cursor: cursor,
    session_stats: null,
  }
}

describe("conversation history pagination", () => {
  beforeEach(() => {
    resetConversationRuntimeStore()
    mockGetFolderConversation.mockReset()
  })

  it("loads one older page at a time and prepends it without duplicates", async () => {
    mockGetFolderConversation.mockResolvedValueOnce(
      detail([turn("turn-150"), turn("turn-151")], true, 150)
    )
    useConversationRuntimeStore.getState().actions.fetchDetail(7)
    await waitFor(() => {
      expect(
        useConversationRuntimeStore.getState().byConversationId.get(7)?.detail
      ).not.toBeNull()
    })

    let resolveOlder!: (value: DbConversationDetail) => void
    mockGetFolderConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOlder = resolve
        })
    )

    const actions = useConversationRuntimeStore.getState().actions
    actions.loadOlderTurns(7)
    actions.loadOlderTurns(7)
    expect(mockGetFolderConversation).toHaveBeenCalledTimes(2)
    expect(mockGetFolderConversation).toHaveBeenLastCalledWith(7, {
      beforeTurn: 150,
      limit: 100,
    })

    resolveOlder(detail([turn("turn-50"), turn("turn-150")], true, 50))
    await waitFor(() => {
      const session = useConversationRuntimeStore
        .getState()
        .byConversationId.get(7)
      expect(session?.olderTurnsLoading).toBe(false)
      expect(session?.detail?.turns.map((item) => item.id)).toEqual([
        "turn-50",
        "turn-150",
        "turn-151",
      ])
      expect(session?.detail?.older_turns_cursor).toBe(50)
    })
  })

  it("clears the single-flight guard after failure so scrolling can retry", async () => {
    mockGetFolderConversation
      .mockResolvedValueOnce(detail([turn("turn-100")], true, 100))
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(detail([turn("turn-0")], false, null))

    const actions = useConversationRuntimeStore.getState().actions
    actions.fetchDetail(7)
    await waitFor(() => {
      expect(
        useConversationRuntimeStore.getState().byConversationId.get(7)?.detail
      ).not.toBeNull()
    })

    actions.loadOlderTurns(7)
    await waitFor(() => {
      const session = useConversationRuntimeStore
        .getState()
        .byConversationId.get(7)
      expect(session?.olderTurnsLoading).toBe(false)
      expect(session?.olderTurnsError).toBe("temporary")
    })

    actions.loadOlderTurns(7)
    await waitFor(() => {
      const session = useConversationRuntimeStore
        .getState()
        .byConversationId.get(7)
      expect(session?.detail?.turns.map((item) => item.id)).toEqual([
        "turn-0",
        "turn-100",
      ])
      expect(session?.detail?.has_older_turns).toBe(false)
    })
  })
})
