import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  reconnect: null as (() => void) | null,
  hasReconnect: true,
  followUpList: vi.fn(),
  followUpSteers: vi.fn(),
}))

vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(async (event: string, handler: (p: unknown) => void) => {
    h.handlers.set(event, handler)
    return () => h.handlers.delete(event)
  }),
  onTransportReconnect: vi.fn((callback: () => void) => {
    if (!h.hasReconnect) return null
    h.reconnect = callback
    return () => {
      h.reconnect = null
    }
  }),
}))

vi.mock("@/lib/follow-up/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/follow-up/api")>()),
  followUpList: h.followUpList,
  followUpSteers: h.followUpSteers,
}))

import {
  FOLLOW_UP_QUEUE_CHANGED_EVENT,
  FOLLOW_UP_STEERS_CHANGED_EVENT,
  type FollowUpQueueView,
} from "@/lib/follow-up/api"
import {
  __resetFollowUpCacheForTests,
  cachedFollowUpQueue,
  cachedFollowUpSteers,
  loadFollowUpQueue,
  loadFollowUpSteers,
} from "@/lib/follow-up/cache"

const view = (id: number, held = false): FollowUpQueueView =>
  ({ conversationId: id, items: [], held }) as FollowUpQueueView

/** Start listening and let the subscriptions settle. */
async function listen() {
  cachedFollowUpQueue(0)
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  __resetFollowUpCacheForTests()
  h.handlers.clear()
  h.reconnect = null
  h.hasReconnect = true
  h.followUpList.mockReset()
  h.followUpSteers.mockReset()
})

describe("follow-up cache", () => {
  it("keeps what it read once the broadcasts are heard", async () => {
    await listen()
    h.followUpList.mockResolvedValue(view(1))
    h.followUpSteers.mockResolvedValue([])
    await loadFollowUpQueue(1)
    await loadFollowUpSteers(1)
    expect(cachedFollowUpQueue(1)).toEqual(view(1))
    expect(cachedFollowUpSteers(1)).toEqual([])
  })

  it("keeps nothing read before it was listening", async () => {
    h.followUpList.mockResolvedValue(view(2))
    await loadFollowUpQueue(2)
    await Promise.resolve()
    expect(cachedFollowUpQueue(2)).toBeNull()
  })

  it("takes each queue broadcast as the view", async () => {
    await listen()
    h.followUpList.mockResolvedValue(view(3))
    await loadFollowUpQueue(3)
    h.handlers.get(FOLLOW_UP_QUEUE_CHANGED_EVENT)!(view(3, true))
    expect(cachedFollowUpQueue(3)).toEqual(view(3, true))
  })

  it("does not keep a read a broadcast overtook", async () => {
    await listen()
    let answer!: (v: FollowUpQueueView) => void
    h.followUpList.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    const read = loadFollowUpQueue(4)
    h.handlers.get(FOLLOW_UP_QUEUE_CHANGED_EVENT)!(view(4, true))
    answer(view(4, false))
    await read
    expect(cachedFollowUpQueue(4)).toEqual(view(4, true))
  })

  it("drops the steers of a conversation whose steers changed", async () => {
    await listen()
    h.followUpSteers.mockResolvedValue([])
    await loadFollowUpSteers(5)
    h.handlers.get(FOLLOW_UP_STEERS_CHANGED_EVENT)!({ conversationId: 5 })
    expect(cachedFollowUpSteers(5)).toBeNull()
  })

  it("drops everything on a reconnect", async () => {
    await listen()
    h.followUpList.mockResolvedValue(view(6))
    h.followUpSteers.mockResolvedValue([])
    await loadFollowUpQueue(6)
    await loadFollowUpSteers(6)
    h.reconnect!()
    expect(cachedFollowUpQueue(6)).toBeNull()
    expect(cachedFollowUpSteers(6)).toBeNull()
  })

  it("keeps nothing where there is no reconnect to hear", async () => {
    h.hasReconnect = false
    await listen()
    h.followUpList.mockResolvedValue(view(7))
    await loadFollowUpQueue(7)
    expect(cachedFollowUpQueue(7)).toBeNull()
  })
})
