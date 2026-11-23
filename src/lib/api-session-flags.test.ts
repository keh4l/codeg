import { beforeEach, describe, expect, it, vi } from "vitest"

const { call, desktop } = vi.hoisted(() => ({
  call: vi.fn(),
  desktop: { local: false },
}))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call }),
  isDesktop: () => desktop.local,
  isRemoteDesktopMode: () => false,
}))

const FLAGS = {
  goal_actions: ["set", "clear"],
  feedback_tool_available: true,
  native_steering_available: false,
}

describe("acpGetSessionFlags", () => {
  beforeEach(() => {
    vi.resetModules()
    call.mockReset()
    desktop.local = false
  })

  it("reads only the flags over the network", async () => {
    const { acpGetSessionFlags } = await import("./api")
    call.mockResolvedValue(FLAGS)
    expect(await acpGetSessionFlags("c1")).toEqual(FLAGS)
    expect(call).toHaveBeenCalledExactlyOnceWith("acp_get_session_flags", {
      connectionId: "c1",
    })
  })

  it("falls back to the snapshot for good on a server without the endpoint", async () => {
    const { acpGetSessionFlags } = await import("./api")
    call.mockImplementation(async (command: string) => {
      if (command === "acp_get_session_flags") {
        throw { code: "not_implemented", message: "no such command" }
      }
      return { ...FLAGS, event_seq: 3 }
    })
    expect(await acpGetSessionFlags("c1")).toMatchObject(FLAGS)
    expect(await acpGetSessionFlags("c1")).toMatchObject(FLAGS)
    expect(call.mock.calls.map(([command]) => command)).toEqual([
      "acp_get_session_flags",
      "acp_get_session_snapshot",
      "acp_get_session_snapshot",
    ])
  })

  it("does not give up on the endpoint over a passing failure", async () => {
    const { acpGetSessionFlags } = await import("./api")
    call.mockRejectedValueOnce({ code: "network_error", message: "offline" })
    await expect(acpGetSessionFlags("c1")).rejects.toMatchObject({
      code: "network_error",
    })
    call.mockResolvedValue(FLAGS)
    expect(await acpGetSessionFlags("c1")).toEqual(FLAGS)
    expect(call).toHaveBeenLastCalledWith("acp_get_session_flags", {
      connectionId: "c1",
    })
  })

  it("reads the snapshot in-process on the local desktop", async () => {
    desktop.local = true
    const { acpGetSessionFlags } = await import("./api")
    call.mockResolvedValue({ ...FLAGS, event_seq: 1 })
    await acpGetSessionFlags("c1")
    expect(call).toHaveBeenCalledExactlyOnceWith("acp_get_session_snapshot", {
      connectionId: "c1",
    })
  })
})
