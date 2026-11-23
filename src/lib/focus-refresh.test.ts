import { afterEach, describe, expect, it, vi } from "vitest"

const platform = vi.hoisted(() => ({ local: false }))
vi.mock("@/lib/platform", () => ({ isLocalDesktop: () => platform.local }))

import { focusRefresh, NETWORK_FOCUS_REFRESH_MS } from "./focus-refresh"

afterEach(() => {
  vi.useRealTimers()
  platform.local = false
})

describe("focusRefresh", () => {
  it("over a network, reads at most once per interval", () => {
    vi.useFakeTimers()
    const read = vi.fn()
    const onFocus = focusRefresh(read)
    onFocus()
    onFocus()
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(NETWORK_FOCUS_REFRESH_MS)
    onFocus()
    onFocus()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("on the local desktop, reads on every focus", () => {
    platform.local = true
    const read = vi.fn()
    const onFocus = focusRefresh(read)
    onFocus()
    onFocus()
    expect(read).toHaveBeenCalledTimes(2)
  })
})
