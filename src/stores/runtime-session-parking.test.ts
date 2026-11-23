/**
 * A runtime session a view lets go of is parked (fork): kept, the most recent
 * few, so the next view of the conversation draws it with no fetch — and told
 * apart, when it is taken back, from one something wrote to meanwhile.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(),
}))

import { getFolderConversation } from "@/lib/api"
import {
  claimRuntimeSession,
  getRuntimeSession,
  parkRuntimeSession,
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
