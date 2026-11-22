import { describe, expect, it } from "vitest"

import {
  alternateFollowUpAction,
  isSlashCommandDraft,
  resolveFollowUpAction,
} from "./dispatch-mode"

describe("resolveFollowUpAction", () => {
  const base = { running: true, alternate: false, canSteer: true } as const

  it("sends normally when nothing is running", () => {
    expect(
      resolveFollowUpAction({ ...base, running: false, behavior: "steer" })
    ).toBe("send")
    expect(
      resolveFollowUpAction({
        ...base,
        running: false,
        alternate: true,
        behavior: "queue",
      })
    ).toBe("send")
  })

  it("uses the per-device default while running", () => {
    expect(resolveFollowUpAction({ ...base, behavior: "steer" })).toBe("steer")
    expect(resolveFollowUpAction({ ...base, behavior: "queue" })).toBe("queue")
  })

  it("flips with the modifier", () => {
    expect(
      resolveFollowUpAction({ ...base, alternate: true, behavior: "steer" })
    ).toBe("queue")
    expect(
      resolveFollowUpAction({ ...base, alternate: true, behavior: "queue" })
    ).toBe("steer")
  })

  it("queues a draft that cannot steer, whatever the modifier says", () => {
    expect(
      resolveFollowUpAction({ ...base, canSteer: false, behavior: "steer" })
    ).toBe("queue")
    expect(
      resolveFollowUpAction({
        ...base,
        canSteer: false,
        alternate: true,
        behavior: "queue",
      })
    ).toBe("queue")
  })

  it("names the alternate action", () => {
    expect(alternateFollowUpAction("steer")).toBe("queue")
    expect(alternateFollowUpAction("queue")).toBe("steer")
  })
})

describe("isSlashCommandDraft", () => {
  it.each([
    ["/compact", true],
    ["  /review the diff", true],
    ["/compact\nkeep the tests", true],
    ["please /compact", false],
    ["/", false],
    ["// a comment", false],
    ["", false],
  ])("%j → %s", (text, expected) => {
    expect(isSlashCommandDraft(text)).toBe(expected)
  })
})
