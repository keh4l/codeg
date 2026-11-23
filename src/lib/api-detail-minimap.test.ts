/**
 * The timeline minimap's list comes with a conversation's first window when
 * the window starts after the first turn (fork): the minimap no longer asks
 * for it in a second round trip.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { call, desktop } = vi.hoisted(() => ({
  call: vi.fn(),
  desktop: { local: false },
}))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call }),
  isDesktop: () => desktop.local,
  isRemoteDesktopMode: () => false,
  getActiveRemoteConnectionId: () => null,
}))

const ENTRIES = [
  {
    turn_index: 0,
    turn_id: "u0",
    timestamp: "2026-11-23T10:00:00Z",
    prompt: "First",
    reply: "Done",
  },
]

function detail(offset: number, minimap?: unknown) {
  return {
    summary: { id: 9 },
    turns: [],
    turns_offset: offset,
    prefix_hash: offset > 0 ? "p" : null,
    ...(minimap === undefined ? {} : { minimap }),
  }
}

async function load() {
  const api = await import("./api")
  const cache = await import("./minimap-cache")
  const prefs = await import("./chat-view-prefs")
  prefs.writeChatViewPrefs({ view: "compact", minimap: true })
  return { api, cache, prefs }
}

describe("getFolderConversation with the minimap", () => {
  beforeEach(() => {
    vi.resetModules()
    call.mockReset()
    desktop.local = false
    window.localStorage.clear()
  })

  it("asks for the list with a first window and keeps it", async () => {
    const { api, cache } = await load()
    call.mockResolvedValue(detail(40, ENTRIES))
    const got = await api.getFolderConversation(9, { tailTurns: 120 })

    expect(call.mock.calls[0]![1]).toMatchObject({ minimap: true })
    expect(got).not.toHaveProperty("minimap")
    expect(cache.cachedMinimap(9, 40, "p")).toEqual(ENTRIES)
  })

  it("does not ask again while a list is kept", async () => {
    const { api } = await load()
    call.mockResolvedValue(detail(40, ENTRIES))
    await api.getFolderConversation(9, { tailTurns: 120 })
    call.mockResolvedValue(detail(40))
    await api.getFolderConversation(9, { tailTurns: 120 })
    expect(call.mock.calls[1]![1]).not.toHaveProperty("minimap")
  })

  it("does not ask when the minimap is not shown, or for a refresh", async () => {
    const { api, prefs } = await load()
    call.mockResolvedValue(detail(40))
    await api.getFolderConversation(9, { fromIndex: 30 })
    prefs.writeChatViewPrefs({ minimap: false })
    await api.getFolderConversation(9, { tailTurns: 120 })
    prefs.writeChatViewPrefs({ minimap: true, view: "timeline" })
    await api.getFolderConversation(9, { tailTurns: 120 })
    for (const [, args] of call.mock.calls) {
      expect(args).not.toHaveProperty("minimap")
    }
  })

  it("does not ask on the local desktop", async () => {
    desktop.local = true
    const { api } = await load()
    call.mockResolvedValue(detail(40))
    await api.getFolderConversation(9, { tailTurns: 120 })
    expect(call.mock.calls[0]![1]).not.toHaveProperty("minimap")
  })
})
