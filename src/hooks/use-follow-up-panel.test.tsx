import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import type { ReactNode } from "react"

import enMessages from "@/i18n/messages/en.json"
import type { UseFollowUpQueueReturn } from "@/hooks/use-follow-up-queue"

const api = vi.hoisted(() => ({
  followUpSteer: vi.fn(),
  followUpEnqueue: vi.fn(),
  followUpKick: vi.fn(),
  followUpSteers: vi.fn(),
}))
vi.mock("@/lib/follow-up/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/follow-up/api")>()),
  ...api,
}))
const listeners = vi.hoisted(
  () => new Map<string, (payload: unknown) => void>()
)
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(async (event: string, handler: (p: unknown) => void) => {
    listeners.set(event, handler)
    return () => listeners.delete(event)
  }),
  onTransportReconnect: vi.fn(() => null),
}))
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() })
)
vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

import { useFollowUpPanel } from "./use-follow-up-panel"

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  )
}

function queue(
  overrides: Partial<UseFollowUpQueueReturn> = {}
): UseFollowUpQueueReturn {
  return {
    queue: [],
    enqueue: vi.fn(),
    requeueFront: vi.fn(),
    dequeue: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    moveToFront: vi.fn(),
    updateItem: vi.fn(),
    getQueueLength: () => 0,
    editingItemId: null,
    startEditing: vi.fn(),
    cancelEditing: vi.fn(),
    serverMode: true,
    held: false,
    resume: vi.fn(),
    sendNow: vi.fn(),
    ...overrides,
  }
}

const base = {
  tabId: "tab-1",
  conversationId: 7,
  connectionId: "c1",
  connStatus: "prompting" as const,
  connectionReady: true,
  awaitingPersist: false,
  modeId: "code",
  onHandBack: vi.fn(),
  onQueueEdit: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  listeners.clear()
  api.followUpSteers.mockResolvedValue([])
  api.followUpKick.mockResolvedValue(false)
  api.followUpEnqueue.mockResolvedValue("id")
})

describe("useFollowUpPanel", () => {
  it("steers through the server with the draft's blocks", async () => {
    api.followUpSteer.mockResolvedValue({
      how: "native",
      steerId: "s",
      itemId: null,
    })
    const { result } = renderHook(
      () => useFollowUpPanel({ ...base, queue: queue() }),
      { wrapper }
    )
    await act(() => result.current.handleSteer("use env.ts"))
    expect(api.followUpSteer).toHaveBeenCalledWith({
      connectionId: "c1",
      conversationId: 7,
      text: "use env.ts",
      blocks: [{ type: "text", text: "use env.ts" }],
      // keh4l build: the server queues it itself if the turn has ended.
      nextMessage: { modeId: "code" },
    })
    expect(toastMock.info).not.toHaveBeenCalled()
  })

  it("says so when the agent could only queue it", async () => {
    api.followUpSteer.mockResolvedValue({
      how: "queued",
      steerId: null,
      itemId: "i",
    })
    const { result } = renderHook(
      () => useFollowUpPanel({ ...base, queue: queue() }),
      { wrapper }
    )
    await act(() => result.current.handleSteer("later"))
    expect(toastMock.info).toHaveBeenCalledWith(enMessages.FollowUp.steerQueued)
  })

  it("sends it as the next message when the turn already ended", async () => {
    api.followUpSteer.mockResolvedValue({
      how: "not_running",
      steerId: null,
      itemId: null,
    })
    const { result } = renderHook(
      () => useFollowUpPanel({ ...base, queue: queue() }),
      { wrapper }
    )
    await act(() => result.current.handleSteer("next"))
    expect(api.followUpEnqueue).toHaveBeenCalledWith({
      conversationId: 7,
      connectionId: "c1",
      text: "next",
      blocks: [{ type: "text", text: "next" }],
      modeId: "code",
      adoptSendTimeMode: false,
    })
  })

  it("offers to put an undelivered steer back in the composer", async () => {
    const onHandBack = vi.fn()
    renderHook(
      () => useFollowUpPanel({ ...base, onHandBack, queue: queue() }),
      { wrapper }
    )
    await waitFor(() =>
      expect(listeners.has("follow-up://steer-undelivered")).toBe(true)
    )
    const blocks = [{ type: "text", text: "use env.ts" }]
    act(() =>
      listeners.get("follow-up://steer-undelivered")?.({
        conversationId: 7,
        connectionId: "c1",
        steerId: "s",
        text: "use env.ts",
        blocks,
      })
    )
    expect(toastMock).toHaveBeenCalledTimes(1)
    const [message, options] = toastMock.mock.calls[0]
    expect(message).toBe("Steer not delivered: “use env.ts”")
    options.action.onClick()
    expect(onHandBack).toHaveBeenCalledWith(blocks)
  })

  it("nudges the server when the connection is ready with messages waiting", async () => {
    const waiting = queue({
      queue: [
        {
          id: "a",
          draft: { blocks: [], displayText: "a" },
          modeId: null,
        },
      ],
    })
    renderHook(
      () =>
        useFollowUpPanel({ ...base, connStatus: "connected", queue: waiting }),
      { wrapper }
    )
    await waitFor(
      () => expect(api.followUpKick).toHaveBeenCalledWith(7, "c1"),
      {
        timeout: 2000,
      }
    )
  })

  it("does not nudge a held queue", async () => {
    const held = queue({
      held: true,
      queue: [
        {
          id: "a",
          draft: { blocks: [], displayText: "a" },
          modeId: null,
        },
      ],
    })
    const { result } = renderHook(
      () => useFollowUpPanel({ ...base, connStatus: "connected", queue: held }),
      { wrapper }
    )
    await new Promise((r) => setTimeout(r, 600))
    expect(api.followUpKick).not.toHaveBeenCalled()
    expect(result.current.heldBar).not.toBeNull()
  })

  it("marks steered turns and the restarts among them", async () => {
    api.followUpSteers.mockResolvedValue([
      {
        id: "s1",
        conversationId: 7,
        how: "restart",
        text: "use env.ts",
        status: "sent",
        createdAt: "2026-11-22T00:00:00Z",
      },
    ])
    const { result } = renderHook(
      () => useFollowUpPanel({ ...base, queue: queue() }),
      { wrapper }
    )
    const userGroup = {
      id: "u",
      role: "user" as const,
      parts: [{ type: "text", text: "use env.ts" }],
      resources: [],
      images: [],
    }
    await waitFor(() =>
      expect(
        result.current.isRestartTurn(
          userGroup as Parameters<typeof result.current.isRestartTurn>[0]
        )
      ).toBe(true)
    )
    expect(
      result.current.userTurnFooter(
        userGroup as Parameters<typeof result.current.userTurnFooter>[0]
      )
    ).not.toBeNull()
  })
})
