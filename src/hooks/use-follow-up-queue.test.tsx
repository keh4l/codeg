import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import type { ReactNode } from "react"

import enMessages from "@/i18n/messages/en.json"
import type { FollowUpQueueView } from "@/lib/follow-up/api"

const api = vi.hoisted(() => ({
  followUpList: vi.fn(),
  followUpEnqueue: vi.fn(),
  followUpRemove: vi.fn(),
  followUpReorder: vi.fn(),
  followUpResume: vi.fn(),
  followUpSendNow: vi.fn(),
  followUpUpdate: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }))

import { useFollowUpQueue } from "./use-follow-up-queue"

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  )
}

function view(items: string[], held = false): FollowUpQueueView {
  return {
    conversationId: 7,
    held,
    items: items.map((text, i) => ({
      id: `id-${text}`,
      conversationId: 7,
      position: i,
      text,
      blocks: [{ type: "text", text }],
      modeId: null,
      adoptSendTimeMode: false,
      createdAt: "2026-11-22T00:00:00Z",
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listeners.clear()
  api.followUpList.mockResolvedValue(view(["a"]))
  api.followUpEnqueue.mockResolvedValue("new-id")
  api.followUpRemove.mockResolvedValue(undefined)
  api.followUpReorder.mockResolvedValue(undefined)
  api.followUpResume.mockResolvedValue(undefined)
  api.followUpUpdate.mockResolvedValue(undefined)
})

describe("useFollowUpQueue — server mode", () => {
  it("loads the server's queue and follows its broadcasts", async () => {
    const { result } = renderHook(
      () => useFollowUpQueue({ conversationId: 7, connectionId: "c1" }),
      { wrapper }
    )
    expect(result.current.serverMode).toBe(true)
    await waitFor(() => expect(result.current.queue).toHaveLength(1))
    expect(result.current.queue[0].draft.displayText).toBe("a")
    act(() =>
      listeners.get("follow-up://queue-changed")?.(view(["a", "b"], true))
    )
    expect(result.current.queue.map((q) => q.id)).toEqual(["id-a", "id-b"])
    expect(result.current.held).toBe(true)
    // Another conversation's broadcast is not ours.
    act(() =>
      listeners.get("follow-up://queue-changed")?.({
        ...view([]),
        conversationId: 8,
      })
    )
    expect(result.current.queue).toHaveLength(2)
  })

  it("enqueues on the server, showing the message at once", async () => {
    const { result } = renderHook(
      () => useFollowUpQueue({ conversationId: 7, connectionId: "c1" }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.queue).toHaveLength(1))
    act(() =>
      result.current.enqueue(
        { blocks: [{ type: "text", text: "b" }], displayText: "b" },
        "plan"
      )
    )
    expect(result.current.queue).toHaveLength(2)
    expect(result.current.getQueueLength()).toBe(2)
    expect(api.followUpEnqueue).toHaveBeenCalledWith({
      conversationId: 7,
      connectionId: "c1",
      text: "b",
      blocks: [{ type: "text", text: "b" }],
      modeId: "plan",
      adoptSendTimeMode: false,
      clientId: expect.any(String),
    })
    // keh4l build: shown under the id the server will give it.
    const [{ clientId }] = api.followUpEnqueue.mock.calls[0] as [
      { clientId: string },
    ]
    expect(result.current.queue[1]?.id).toBe(clientId)
    // The server sends it, never the browser.
    expect(result.current.dequeue()).toBeUndefined()
  })

  it("removes, reorders, edits and resumes through the server", async () => {
    api.followUpList.mockResolvedValue(view(["a", "b"], true))
    const { result } = renderHook(
      () => useFollowUpQueue({ conversationId: 7, connectionId: "c1" }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.queue).toHaveLength(2))
    act(() => result.current.moveToFront("id-b"))
    await waitFor(() =>
      expect(api.followUpReorder).toHaveBeenCalledWith(7, ["id-b", "id-a"])
    )
    act(() => result.current.startEditing("id-a"))
    expect(result.current.editingItemId).toBe("id-a")
    act(() =>
      result.current.updateItem("id-a", {
        blocks: [{ type: "text", text: "a2" }],
        displayText: "a2",
      })
    )
    await waitFor(() =>
      expect(api.followUpUpdate).toHaveBeenCalledWith("id-a", "a2", [
        { type: "text", text: "a2" },
      ])
    )
    expect(result.current.editingItemId).toBeNull()
    act(() => result.current.remove("id-b"))
    await waitFor(() => expect(api.followUpRemove).toHaveBeenCalledWith("id-b"))
    expect(result.current.queue.map((q) => q.id)).toEqual(["id-a"])
    act(() => result.current.resume())
    expect(api.followUpResume).toHaveBeenCalledWith(7, "c1")
    expect(result.current.held).toBe(false)
  })
})

describe("useFollowUpQueue — before the server confirms (fork)", () => {
  it("removes a just-queued message once its enqueue has landed", async () => {
    let land: (id: string) => void = () => {}
    api.followUpEnqueue.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          land = resolve
        })
    )
    const { result } = renderHook(
      () => useFollowUpQueue({ conversationId: 7, connectionId: "c1" }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.queue).toHaveLength(1))
    act(() =>
      result.current.enqueue(
        { blocks: [{ type: "text", text: "b" }], displayText: "b" },
        null
      )
    )
    const id = result.current.queue[1]!.id
    act(() => result.current.remove(id))
    expect(result.current.queue.map((q) => q.id)).not.toContain(id)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(api.followUpRemove).not.toHaveBeenCalled()
    await act(async () => land(id))
    await waitFor(() => expect(api.followUpRemove).toHaveBeenCalledWith(id))
  })

  it("does not remove on the server what never got there", async () => {
    api.followUpEnqueue.mockRejectedValueOnce(new Error("offline"))
    const { result } = renderHook(
      () => useFollowUpQueue({ conversationId: 7, connectionId: "c1" }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.queue).toHaveLength(1))
    act(() =>
      result.current.enqueue(
        { blocks: [{ type: "text", text: "b" }], displayText: "b" },
        null
      )
    )
    const id = result.current.queue[1]!.id
    act(() => result.current.remove(id))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(api.followUpRemove).not.toHaveBeenCalled()
  })
})

describe("useFollowUpQueue — before the conversation exists", () => {
  it("keeps a local queue and hands it to the server once it exists", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: number | null }) =>
        useFollowUpQueue({ conversationId: id, connectionId: "c1" }),
      { wrapper, initialProps: { id: null as number | null } }
    )
    expect(result.current.serverMode).toBe(false)
    act(() =>
      result.current.enqueue(
        { blocks: [{ type: "text", text: "early" }], displayText: "early" },
        null,
        { adoptSendTimeMode: true }
      )
    )
    expect(result.current.queue).toHaveLength(1)
    expect(api.followUpEnqueue).not.toHaveBeenCalled()
    api.followUpList.mockResolvedValue(view([]))
    rerender({ id: 7 })
    await waitFor(() =>
      expect(api.followUpEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 7,
          text: "early",
          adoptSendTimeMode: true,
        })
      )
    )
  })
})
