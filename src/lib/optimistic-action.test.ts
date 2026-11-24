import { describe, expect, it, vi } from "vitest"

import { retryWhile, runOptimistic } from "./optimistic-action"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("runOptimistic", () => {
  it("changes the screen before the request and keeps it on success", async () => {
    const order: string[] = []
    const undo = vi.fn()
    const request = deferred<number>()
    const run = runOptimistic({
      key: "a",
      apply: () => {
        order.push("apply")
        return undo
      },
      commit: () => {
        order.push("commit")
        return request.promise
      },
    })
    expect(order).toEqual(["apply", "commit"])
    request.resolve(7)
    expect(await run).toEqual({ status: "done", value: 7 })
    expect(undo).not.toHaveBeenCalled()
  })

  it("takes the change back and tells the user when it fails", async () => {
    const undo = vi.fn()
    const onError = vi.fn()
    const outcome = await runOptimistic({
      key: "b",
      apply: () => undo,
      commit: () => Promise.reject(new Error("offline")),
      onError,
    })
    expect(outcome.status).toBe("failed")
    expect(undo).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(new Error("offline"))
  })

  it("leaves the screen to a newer action with the same key", async () => {
    const undoOld = vi.fn()
    const onError = vi.fn()
    const oldRequest = deferred<void>()
    let oldStillWanted = () => true
    const old = runOptimistic({
      key: "c",
      apply: () => undoOld,
      commit: (stillWanted) => {
        oldStillWanted = stillWanted
        return oldRequest.promise
      },
      onError,
    })
    const newer = runOptimistic({
      key: "c",
      apply: () => undefined,
      commit: () => Promise.resolve(),
    })
    expect(oldStillWanted()).toBe(false)
    oldRequest.reject(new Error("late"))
    expect(await old).toEqual({ status: "superseded" })
    expect(undoOld).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect((await newer).status).toBe("done")
  })

  it("counts a failure that means it is already done as done", async () => {
    const undo = vi.fn()
    const outcome = await runOptimistic({
      key: "d",
      apply: () => undo,
      commit: () => Promise.reject({ code: "not_found" }),
      isAlreadyDone: (e) => (e as { code?: string }).code === "not_found",
    })
    expect(outcome.status).toBe("done")
    expect(undo).not.toHaveBeenCalled()
  })

  it("hands the call retries that stop once superseded", () => {
    let wanted = true
    const options = retryWhile(() => wanted)
    expect(options.retry.attempts).toBe(2)
    expect(options.retry.stillWanted()).toBe(true)
    wanted = false
    expect(options.retry.stillWanted()).toBe(false)
  })
})
