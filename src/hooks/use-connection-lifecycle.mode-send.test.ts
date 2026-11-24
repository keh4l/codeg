/**
 * keh4l build: in the browser a send that changes the mode is ONE request —
 * the mode goes with the prompt — instead of `set_mode` and then the prompt
 * one round trip later. A desktop window keeps the two calls (it may be on an
 * older remote server that would drop the mode).
 */

import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  desktop: false,
  sendPrompt: vi.fn(async () => {}),
  setMode: vi.fn(async () => {}),
}))

vi.mock("@/lib/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transport")>()),
  isDesktop: () => h.desktop,
}))
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}))
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock("@/contexts/acp-connections-context", () => ({
  useAcpActions: () => ({
    setActiveKey: vi.fn(),
    releaseActiveKey: vi.fn(),
    parkConnection: vi.fn(),
    touchActivity: vi.fn(),
  }),
}))
vi.mock("@/contexts/task-context", () => ({
  useTaskContext: () => ({
    addTask: vi.fn(),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
  }),
}))
vi.mock("@/hooks/use-connection", () => ({
  useConnection: () => ({
    status: "connected",
    selectorsReady: true,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendPrompt: h.sendPrompt,
    setMode: h.setMode,
    setConfigOption: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    respondPermission: vi.fn().mockResolvedValue(undefined),
    modes: null,
    configOptions: null,
    hasCachedSelectors: true,
    isViewer: false,
    backgroundOutstanding: 0,
    asyncTasks: [],
    remoteControl: null,
    delegatedChildren: [],
  }),
}))

import { useConnectionLifecycle } from "@/hooks/use-connection-lifecycle"

const draft = () => ({
  blocks: [{ type: "text" as const, text: "hello" }],
  displayText: "hello",
})

async function send(modeId: string | null) {
  const { result } = renderHook(() =>
    useConnectionLifecycle({
      contextKey: "ctx-1",
      agentType: "claude_code",
      isActive: true,
    })
  )
  await act(async () => {
    result.current.handleSend(draft(), modeId, { clientMessageId: "m-1" })
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  h.sendPrompt.mockClear()
  h.setMode.mockClear()
})

describe("useConnectionLifecycle mode + send", () => {
  it("sends the mode with the prompt in the browser", async () => {
    h.desktop = false
    await send("plan")
    expect(h.setMode).not.toHaveBeenCalled()
    expect(h.sendPrompt).toHaveBeenCalledWith(draft().blocks, {
      clientMessageId: "m-1",
      modeId: "plan",
    })
  })

  it("keeps set_mode then the prompt in a desktop window", async () => {
    h.desktop = true
    await send("plan")
    expect(h.setMode).toHaveBeenCalledWith("plan")
    expect(h.sendPrompt).toHaveBeenCalledWith(draft().blocks, {
      clientMessageId: "m-1",
    })
  })
})
