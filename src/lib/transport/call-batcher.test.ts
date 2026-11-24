import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CallBatcher, type CallBatcherDeps } from "./call-batcher"

function response(status: number, body: unknown, challenge?: string) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: challenge ? { "WWW-Authenticate": challenge } : {},
  })
}

type Outcome = { value: unknown } | { error: unknown }

/** The call's outcome, caught at once so a rejection is never unhandled. */
function outcome(p: Promise<unknown>): Promise<Outcome> {
  return p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  )
}

const failed = async (p: Promise<Outcome>) =>
  String(((await p) as { error?: unknown }).error)

function setup(over: Partial<CallBatcherDeps> = {}) {
  const deps = {
    sendBatch: vi.fn<CallBatcherDeps["sendBatch"]>(),
    callDirect: vi.fn<CallBatcherDeps["callDirect"]>(async (command) => ({
      direct: command,
    })),
    onUnauthorized: vi.fn<CallBatcherDeps["onUnauthorized"]>(),
  }
  return { deps, batcher: new CallBatcher({ ...deps, ...over }) }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("CallBatcher", () => {
  it("sends calls made together as one batch, each settling as it would alone", async () => {
    const { deps, batcher } = setup()
    deps.sendBatch.mockResolvedValue(
      response(200, {
        results: [
          { s: 200, b: [1, 2] },
          { s: 200, b: null },
          { s: 500, b: { code: "io_error", message: "disk" } },
          { s: 502, t: "<html>bad gateway</html>" },
        ],
      })
    )
    const a = outcome(batcher.call("list_all_conversations", undefined))
    const b = outcome(batcher.call("get_tab_sync_settings", {}))
    const c = outcome(batcher.call("list_opened_tabs", {}))
    const d = outcome(batcher.call("assistant_list", {}))
    await vi.advanceTimersByTimeAsync(10)

    expect(deps.sendBatch).toHaveBeenCalledExactlyOnceWith([
      { cmd: "list_all_conversations", args: {} },
      { cmd: "get_tab_sync_settings", args: {} },
      { cmd: "list_opened_tabs", args: {} },
      { cmd: "assistant_list", args: {} },
    ])
    expect(await a).toEqual({ value: [1, 2] })
    expect(await b).toEqual({ value: null })
    expect(await c).toEqual({ error: { code: "io_error", message: "disk" } })
    expect(await d).toEqual({
      error: { code: "network_error", message: "HTTP 502" },
    })
    expect(deps.callDirect).not.toHaveBeenCalled()
  })

  it("sends a call that is alone in its window directly", async () => {
    const { deps, batcher } = setup()
    const a = outcome(batcher.call("list_all_conversations", { x: 1 }))
    await vi.advanceTimersByTimeAsync(10)
    expect(await a).toEqual({ value: { direct: "list_all_conversations" } })
    expect(deps.sendBatch).not.toHaveBeenCalled()
  })

  it("sends a deferred call again, alone", async () => {
    const { deps, batcher } = setup()
    deps.sendBatch.mockResolvedValue(
      response(200, { results: [{ s: 200, b: 1 }, { d: true }] })
    )
    const a = outcome(batcher.call("list_folder_groups", {}))
    const b = outcome(batcher.call("list_all_conversations", {}))
    await vi.advanceTimersByTimeAsync(10)
    expect(await a).toEqual({ value: 1 })
    expect(await b).toEqual({ value: { direct: "list_all_conversations" } })
  })

  it("reports a call's 401 with its challenge", async () => {
    const { deps, batcher } = setup()
    deps.sendBatch.mockResolvedValue(
      response(200, {
        results: [
          { s: 200, b: 1 },
          { s: 401, w: 'Bearer realm="codeg"' },
        ],
      })
    )
    const a = outcome(batcher.call("list_folder_groups", {}))
    const b = outcome(batcher.call("list_all_conversations", {}))
    await vi.advanceTimersByTimeAsync(10)
    expect(await a).toEqual({ value: 1 })
    expect(await failed(b)).toContain("Unauthorized")
    expect(deps.onUnauthorized).toHaveBeenCalledWith('Bearer realm="codeg"')
  })

  it("rejects every call when the batch itself is refused", async () => {
    const { deps, batcher } = setup()
    deps.sendBatch.mockResolvedValue(response(401, "", "Bearer realm=codeg"))
    const a = outcome(batcher.call("list_folder_groups", {}))
    const b = outcome(batcher.call("list_all_conversations", {}))
    await vi.advanceTimersByTimeAsync(10)
    expect(await failed(a)).toContain("Unauthorized")
    expect(await failed(b)).toContain("Unauthorized")
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it("turns itself off for good on a server without batches", async () => {
    const { deps, batcher } = setup()
    deps.sendBatch.mockResolvedValue(
      response(501, { code: "not_implemented", message: "no" })
    )
    const a = outcome(batcher.call("list_folder_groups", {}))
    const b = outcome(batcher.call("list_all_conversations", {}))
    await vi.advanceTimersByTimeAsync(10)
    expect(await a).toEqual({ value: { direct: "list_folder_groups" } })
    expect(await b).toEqual({ value: { direct: "list_all_conversations" } })
    expect(batcher.accepts("list_folder_groups")).toBe(false)
  })

  it("sends every call alone when the batch fails on the server or answers oddly", async () => {
    const { deps, batcher } = setup()
    deps.sendBatch
      .mockResolvedValueOnce(response(500, { code: "x" }))
      .mockResolvedValueOnce(response(200, { results: [{ s: 200, b: 1 }] }))
    const a = outcome(batcher.call("list_folder_groups", {}))
    const b = outcome(batcher.call("list_all_conversations", {}))
    await vi.advanceTimersByTimeAsync(10)
    expect(await a).toEqual({ value: { direct: "list_folder_groups" } })
    expect(await b).toEqual({ value: { direct: "list_all_conversations" } })
    const c = outcome(batcher.call("list_folder_groups", {}))
    const d = outcome(batcher.call("list_all_conversations", {}))
    await vi.advanceTimersByTimeAsync(10)
    expect(await c).toEqual({ value: { direct: "list_folder_groups" } })
    expect(await d).toEqual({ value: { direct: "list_all_conversations" } })
    expect(batcher.accepts("list_folder_groups")).toBe(true)
  })

  it("rejects every call as a direct call would when the network fails", async () => {
    const { deps, batcher } = setup()
    deps.sendBatch.mockRejectedValue(new TypeError("Failed to fetch"))
    const a = outcome(batcher.call("list_folder_groups", {}))
    const b = outcome(batcher.call("list_all_conversations", {}))
    await vi.advanceTimersByTimeAsync(10)
    expect(await failed(a)).toContain("Failed to fetch")
    expect(await failed(b)).toContain("Failed to fetch")
  })

  it("sends directly while the page is hidden, and only quick reads batch", async () => {
    const { deps, batcher } = setup({ isHidden: () => true })
    await batcher.call("list_folder_groups", {})
    expect(deps.callDirect).toHaveBeenCalledTimes(1)
    expect(batcher.accepts("acp_prompt")).toBe(false)
    expect(batcher.accepts("get_folder_conversation")).toBe(false)
  })
})
