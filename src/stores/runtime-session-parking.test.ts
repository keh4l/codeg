/**
 * A runtime session a view lets go of is parked (fork): kept, the most recent
 * few, so the next view of the conversation draws it with no fetch — and told
 * apart, when it is taken back, from one something wrote to meanwhile. And one
 * read ahead of a click (sidebar) is kept apart from those.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(),
}))

import { getFolderConversation } from "@/lib/api"
import {
  adoptPrefetchedSession,
  claimRuntimeSession,
  getRuntimeSession,
  parkRuntimeSession,
  prefetchRuntimeSession,
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"
import type { DbConversationDetail } from "@/lib/types"

/** A session whose detail has loaded, as a view leaves it. */
async function seed(conversationId: number) {
  vi.mocked(getFolderConversation).mockResolvedValueOnce({
    summary: { id: conversationId, external_id: null },
    turns: [],
  } as unknown as DbConversationDetail)
  useConversationRuntimeStore.getState().actions.fetchDetail(conversationId)
  await vi.waitFor(() =>
    expect(getRuntimeSession(conversationId)?.detail).toBeTruthy()
  )
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  resetConversationRuntimeStore()
})

describe("parked runtime sessions", () => {
  it("keeps a parked session and hands it back unchanged", async () => {
    await seed(1)
    parkRuntimeSession(1)
    await nextTask()
    expect(getRuntimeSession(1)?.detail).toBeTruthy()

    const reclaimed = claimRuntimeSession(1)
    expect(reclaimed).toMatchObject({ changed: false })
    // Taken back: no longer parked.
    expect(claimRuntimeSession(1)).toBeNull()
  })

  it("says when something wrote to it while it was parked", async () => {
    await seed(2)
    parkRuntimeSession(2)
    useConversationRuntimeStore
      .getState()
      .actions.setLiveMessage(
        2,
        { id: "lm", role: "assistant", content: [], startedAt: 0 },
        true
      )
    expect(claimRuntimeSession(2)).toMatchObject({ changed: true })
  })

  it("releases a session with nothing to show, as before", async () => {
    useConversationRuntimeStore
      .getState()
      .actions.setLiveMessage(
        3,
        { id: "lm", role: "assistant", content: [], startedAt: 0 },
        false
      )
    parkRuntimeSession(3)
    await nextTask()
    expect(getRuntimeSession(3)).toBeNull()
  })

  it("drops the oldest past the budget", async () => {
    for (let id = 10; id < 19; id += 1) {
      await seed(id)
      parkRuntimeSession(id)
    }
    expect(getRuntimeSession(10)).toBeNull()
    for (let id = 11; id < 19; id += 1) {
      expect(getRuntimeSession(id)).not.toBeNull()
    }
  })

  it("forgets what it parked on reset", async () => {
    await seed(20)
    parkRuntimeSession(20)
    resetConversationRuntimeStore()
    expect(claimRuntimeSession(20)).toBeNull()
  })
})

describe("sessions read ahead of a click", () => {
  it("reads the detail, and a view showing it takes it over", async () => {
    vi.mocked(getFolderConversation).mockResolvedValueOnce({
      summary: { id: 30, external_id: null },
      turns: [],
    } as unknown as DbConversationDetail)
    prefetchRuntimeSession(30)
    await vi.waitFor(() => expect(getRuntimeSession(30)?.detail).toBeTruthy())
    adoptPrefetchedSession(30)
    // Owned now: four more read-aheads do not push it out.
    for (let id = 31; id < 36; id += 1) {
      vi.mocked(getFolderConversation).mockResolvedValueOnce({
        summary: { id, external_id: null },
        turns: [],
      } as unknown as DbConversationDetail)
      prefetchRuntimeSession(id)
    }
    expect(getRuntimeSession(30)).not.toBeNull()
  })

  it("keeps the last four, and never pushes out a parked one", async () => {
    await seed(40)
    parkRuntimeSession(40)
    for (let id = 41; id < 46; id += 1) {
      vi.mocked(getFolderConversation).mockResolvedValueOnce({
        summary: { id, external_id: null },
        turns: [],
      } as unknown as DbConversationDetail)
      prefetchRuntimeSession(id)
    }
    expect(getRuntimeSession(41)).toBeNull()
    for (let id = 42; id < 46; id += 1) {
      expect(getRuntimeSession(id)).not.toBeNull()
    }
    expect(getRuntimeSession(40)?.detail).toBeTruthy()
  })

  it("leaves a conversation already loaded alone", async () => {
    await seed(50)
    vi.mocked(getFolderConversation).mockClear()
    prefetchRuntimeSession(50)
    expect(getFolderConversation).not.toHaveBeenCalled()
  })

  it("drops a read that failed when a view takes it, so the view reads now", async () => {
    vi.mocked(getFolderConversation).mockRejectedValueOnce(new Error("offline"))
    prefetchRuntimeSession(60)
    await vi.waitFor(() =>
      expect(getRuntimeSession(60)?.detailError).toBeTruthy()
    )
    adoptPrefetchedSession(60)
    expect(getRuntimeSession(60)).toBeNull()
  })
})
