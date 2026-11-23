/**
 * The view's unmount cleanup (tab closed, preview slot taken, the conversation
 * surface swapped out) PARKS its connection (fork): kept, attach and agent
 * alive, so opening the conversation again is instant — never disconnected on
 * the spot, so no work the agent still has in flight is killed with it. The
 * parked budget releases it later, through the same busy gate the sweeps use
 * (`isConnectionBusy`, tested on its own).
 *
 * It must also give back the active key the view claimed — before parking, or
 * the parked connection would count as taken back — or the connection it
 * leaves running stays out of both sweeps.
 */

import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AsyncTaskRecord, RemoteControlInfo } from "@/lib/types"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

const acp = vi.hoisted(() => ({
  setActiveKey: (() => {}) as (key: string | null) => void,
  releaseActiveKey: (() => {}) as (key: string) => void,
  touchActivity: (() => {}) as (key: string) => void,
  parkConnection: (() => {}) as (key: string, runtimeId?: number) => void,
}))

vi.mock("@/contexts/acp-connections-context", () => ({
  useAcpActions: () => acp,
}))

vi.mock("@/contexts/task-context", () => {
  const context = { addTask: vi.fn(), updateTask: vi.fn(), removeTask: vi.fn() }
  return { useTaskContext: () => context }
})

const conn = vi.hoisted(() => ({
  isViewer: false,
  asyncTasks: [] as AsyncTaskRecord[],
  remoteControl: null as RemoteControlInfo | null,
  delegatedChildren: [] as string[],
  disconnect: (() => Promise.resolve()) as () => Promise<void>,
}))

vi.mock("@/hooks/use-connection", () => {
  const noop = vi.fn().mockResolvedValue(undefined)
  return {
    useConnection: () => ({
      status: "connected",
      agentType: "codex",
      connectError: null,
      selectorsReady: true,
      hasCachedSelectors: true,
      connect: noop,
      disconnect: conn.disconnect,
      sendPrompt: noop,
      setMode: noop,
      setConfigOption: noop,
      cancel: noop,
      respondPermission: noop,
      modes: null,
      configOptions: null,
      isViewer: conn.isViewer,
      backgroundOutstanding: 0,
      asyncTasks: conn.asyncTasks,
      remoteControl: conn.remoteControl,
      delegatedChildren: conn.delegatedChildren,
    }),
  }
})

import { useConnectionLifecycle } from "@/hooks/use-connection-lifecycle"

function backgroundTerminal(state: string): AsyncTaskRecord {
  return {
    task_id: "call_bg_1",
    name: "npm run dev",
    task_type: "shell",
    description: "",
    show_in_transcript: false,
    can_stop: true,
    state,
  }
}

const KEY = "conv-1-codex-42"

function closeView(
  opts: { isActive?: boolean; transient?: boolean; runtimeId?: number } = {}
) {
  const view = renderHook(() =>
    useConnectionLifecycle({
      contextKey: KEY,
      agentType: "codex",
      isActive: opts.isActive ?? false,
      isTransientUnmount: () => opts.transient === true,
      runtimeConversationId: opts.runtimeId,
    })
  )
  view.unmount()
}

describe("useConnectionLifecycle unmount", () => {
  let disconnect: ReturnType<typeof vi.fn>
  let releaseActiveKey: ReturnType<typeof vi.fn>
  let parkConnection: ReturnType<typeof vi.fn>
  let calls: string[]

  beforeEach(() => {
    calls = []
    disconnect = vi.fn().mockResolvedValue(undefined)
    conn.disconnect = disconnect as unknown as () => Promise<void>
    conn.isViewer = false
    conn.asyncTasks = []
    conn.remoteControl = null
    conn.delegatedChildren = []
    releaseActiveKey = vi.fn(() => calls.push("release"))
    parkConnection = vi.fn(() => calls.push("park"))
    acp.setActiveKey = vi.fn()
    acp.releaseActiveKey = releaseActiveKey as unknown as (key: string) => void
    acp.parkConnection = parkConnection as unknown as (key: string) => void
    acp.touchActivity = vi.fn()
  })

  it("parks an idle owner with the session it feeds, never disconnecting", () => {
    closeView({ runtimeId: 42 })

    expect(parkConnection).toHaveBeenCalledExactlyOnceWith(KEY, 42)
    expect(disconnect).not.toHaveBeenCalled()
  })

  it("parks an owner with work in flight the same way", () => {
    conn.asyncTasks = [backgroundTerminal("running")]
    conn.remoteControl = { session_url: "https://claude.ai/code/session_01" }
    conn.delegatedChildren = ["child-conn"]

    closeView()

    expect(parkConnection).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveBeenCalled()
  })

  it("parks a viewer too (its budget detaches it later)", () => {
    conn.isViewer = true

    closeView()

    expect(parkConnection).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveBeenCalled()
  })

  it("gives back the active key it claimed before parking", () => {
    closeView({ isActive: true })

    expect(acp.setActiveKey).toHaveBeenCalledWith(KEY)
    expect(calls).toEqual(["release", "park"])
    expect(releaseActiveKey).toHaveBeenCalledWith(KEY)
  })

  it("keeps the claim and parks nothing across a transient (reparent) unmount", () => {
    closeView({ isActive: true, transient: true })

    expect(parkConnection).not.toHaveBeenCalled()
    expect(disconnect).not.toHaveBeenCalled()
    expect(releaseActiveKey).not.toHaveBeenCalled()
  })
})
