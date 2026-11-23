import { describe, expect, it } from "vitest"

import { SEND_ANCHOR_TOP_PX, sendAnchorSpacerHeight } from "./anchor-spacer"

describe("sendAnchorSpacerHeight", () => {
  const viewportHeight = 1000

  it("lets the furthest scroll put the anchored message exactly at the top offset", () => {
    // Message at 5000, 300px of real content below it, 700px spacer now.
    const anchorTop = 5000
    const below = 300
    const currentSpacer = 700
    const scrollHeight = anchorTop + below + currentSpacer
    const spacer = sendAnchorSpacerHeight({
      viewportHeight,
      scrollHeight,
      anchorTop,
      currentSpacer,
    })
    expect(spacer).toBe(viewportHeight - SEND_ANCHOR_TOP_PX - below)
    // Max scrollTop with that spacer puts the message SEND_ANCHOR_TOP_PX down.
    const maxScrollTop = anchorTop + below + spacer - viewportHeight
    expect(anchorTop - maxScrollTop).toBe(SEND_ANCHOR_TOP_PX)
  })

  it("shrinks as the reply grows and is gone once the reply fills the viewport", () => {
    const anchorTop = 2000
    const at = (below: number, currentSpacer: number) =>
      sendAnchorSpacerHeight({
        viewportHeight,
        scrollHeight: anchorTop + below + currentSpacer,
        anchorTop,
        currentSpacer,
      })
    expect(at(100, 840)).toBe(876)
    expect(at(600, 876)).toBe(376)
    expect(at(976, 376)).toBe(0)
    expect(at(3000, 0)).toBe(0)
  })

  it("grows back when the reply gets shorter, so the view does not jump", () => {
    const anchorTop = 2000
    // Live reply 900px tall, then it folds into a 120px line.
    const before = sendAnchorSpacerHeight({
      viewportHeight,
      scrollHeight: anchorTop + 900 + 76,
      anchorTop,
      currentSpacer: 76,
    })
    expect(before).toBe(76)
    const after = sendAnchorSpacerHeight({
      viewportHeight,
      scrollHeight: anchorTop + 120 + before,
      anchorTop,
      currentSpacer: before,
    })
    expect(after).toBe(viewportHeight - SEND_ANCHOR_TOP_PX - 120)
  })
})
