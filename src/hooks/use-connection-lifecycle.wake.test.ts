import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

const actions = vi.hoisted(() => ({
  setActiveKey: vi.fn(),
  releaseActiveKey: vi.fn(),
  touchActivity: vi.fn(),
}))

vi.mock("@/contexts/acp-connections-context", () => ({
  useAcpActions: () => actions,
}))

vi.mock("@/contexts/task-context", () => {
  const ctx = {
    addTask: vi.fn(),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
  }
  return { useTaskContext: () => ctx }
})

const conn = vi.hoisted(() => ({
  status: "connected" as string | null,
  connect: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/hooks/use-connection", () => ({
  useConnection: () => ({
    status: conn.status,
    agentType: "claude_code",
    selectorsReady: true,
    hasCachedSelectors: true,
    connect: conn.connect,
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setConfigOption: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    respondPermission: vi.fn().mockResolvedValue(undefined),
    modes: null,
    configOptions: null,
    isViewer: false,
    backgroundOutstanding: 0,
    asyncTasks: [],
    remoteControl: null,
    delegatedChildren: [],
  }),
}))

import { useConnectionLifecycle } from "@/hooks/use-connection-lifecycle"

function renderActiveLifecycle() {
  return renderHook(() =>
    useConnectionLifecycle({
      contextKey: "tab-1",
      agentType: "claude_code",
      isActive: true,
      workingDir: "/repo",
      sessionId: "sess-1",
      conversationId: 42,
    })
  )
}

describe("useConnectionLifecycle foreground wake auto-reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    conn.status = "connected"
    conn.connect.mockClear()
    actions.touchActivity.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("reconnects immediately on wake when the active connection is already disconnected", () => {
    conn.status = "disconnected"
    renderActiveLifecycle()
    // Initial auto-connect on mount counts once; clear to isolate wake behavior.
    conn.connect.mockClear()

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })

    expect(actions.touchActivity).toHaveBeenCalledWith("tab-1")
    expect(conn.connect).toHaveBeenCalledTimes(1)
    expect(conn.connect).toHaveBeenCalledWith(
      "claude_code",
      "/repo",
      "sess-1",
      42
    )
  })

  it("reconnects once when the keepalive liveness probe settles a reaped connection right after wake", () => {
    conn.status = "connected"
    const { rerender } = renderActiveLifecycle()
    conn.connect.mockClear()

    // Wake while status still reads "connected" (before liveness probe returns).
    act(() => {
      window.dispatchEvent(new Event("pageshow"))
    })
    expect(conn.connect).not.toHaveBeenCalled()

    // 200ms later, the keepalive probe discovers the backend reaped the idle agent.
    act(() => {
      vi.advanceTimersByTime(200)
      conn.status = "disconnected"
      rerender()
    })
    expect(conn.connect).toHaveBeenCalledTimes(1)

    // A subsequent drop without a new wake event does NOT trigger a reconnect loop.
    conn.connect.mockClear()
    act(() => {
      conn.status = "connected"
      rerender()
    })
    act(() => {
      conn.status = "disconnected"
      rerender()
    })
    expect(conn.connect).not.toHaveBeenCalled()
  })

  it("never auto-reconnects on wake when the connection is in error state", () => {
    conn.status = "error"
    renderActiveLifecycle()
    conn.connect.mockClear()

    act(() => {
      window.dispatchEvent(new Event("online"))
      document.dispatchEvent(new Event("visibilitychange"))
    })

    expect(conn.connect).not.toHaveBeenCalled()
  })
})
