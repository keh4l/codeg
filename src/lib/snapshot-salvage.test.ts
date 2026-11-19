import { describe, expect, it } from "vitest"

import { salvageSnapshot } from "@/lib/snapshot-salvage"

describe("salvageSnapshot", () => {
  it("reads the fields that decide whether a surface is usable", () => {
    expect(
      salvageSnapshot({
        connection_id: "conn-1",
        status: "prompting",
        external_id: "sess-1",
        selectors_ready: true,
        fork_supported: true,
        event_seq: 42,
        // Whatever made the full read throw is simply not looked at.
        live_message: { content: "not an array" },
        active_tool_calls: null,
      })
    ).toEqual({
      connectionId: "conn-1",
      status: "prompting",
      sessionId: "sess-1",
      selectorsReady: true,
      supportsFork: true,
      eventSeq: 42,
    })
  })

  it("defaults what is missing or malformed instead of throwing", () => {
    expect(
      salvageSnapshot({
        connection_id: "conn-1",
        status: "connected",
        external_id: 7,
        selectors_ready: "yes",
        event_seq: Number.NaN,
      })
    ).toEqual({
      connectionId: "conn-1",
      status: "connected",
      sessionId: null,
      selectorsReady: false,
      supportsFork: false,
      eventSeq: 0,
    })
  })

  it("gives up when it cannot tell which connection or which state", () => {
    expect(salvageSnapshot(null)).toBeNull()
    expect(salvageSnapshot("snapshot")).toBeNull()
    expect(salvageSnapshot({ status: "prompting" })).toBeNull()
    expect(salvageSnapshot({ connection_id: "", status: "prompting" })).toBe(
      null
    )
    expect(
      salvageSnapshot({ connection_id: "conn-1", status: "thinking" })
    ).toBeNull()
  })
})
