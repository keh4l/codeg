import { describe, expect, it } from "vitest"

import { shouldTriggerTopLoad } from "./virtualized-message-thread"

describe("reverse infinite-scroll guards", () => {
  it("ignores initial positioning and downward movement", () => {
    expect(shouldTriggerTopLoad(null, 0, 160)).toBe(false)
    expect(shouldTriggerTopLoad(0, 1200, 160)).toBe(false)
    expect(shouldTriggerTopLoad(1200, 500, 160)).toBe(false)
  })

  it("triggers only when scrolling upward into the top threshold", () => {
    expect(shouldTriggerTopLoad(300, 150, 160)).toBe(true)
    expect(shouldTriggerTopLoad(150, 160, 160)).toBe(false)
  })
})
