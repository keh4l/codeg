import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DbConversationSummary } from "@/lib/types"

import {
  SETTLED_HOLD_MS,
  __resetConversationHoldsForTests,
  holdConversationField,
  overlayConversation,
  overlayConversations,
} from "./conversation-row-overlay"

const row = (patch: Partial<DbConversationSummary>) =>
  ({
    id: 1,
    title: "Old",
    status: "in_progress",
    pinned_at: null,
    ...patch,
  }) as DbConversationSummary

beforeEach(() => {
  vi.useFakeTimers()
  __resetConversationHoldsForTests()
})
afterEach(() => vi.useRealTimers())

describe("conversation row holds", () => {
  it("lays a pending change over rows the server sends until one shows it", () => {
    holdConversationField(1, "title", "New")
    expect(overlayConversations([row({}), row({ id: 2 })])).toEqual([
      row({ title: "New" }),
      row({ id: 2 }),
    ])
    // The broadcast of the change itself: confirmed, no longer held.
    expect(overlayConversation(row({ title: "New", status: "x" }))).toEqual(
      row({ title: "New", status: "x" })
    )
    expect(overlayConversation(row({}))).toEqual(row({}))
  })

  it("stops holding at once on failure, and a while after success", () => {
    const failed = holdConversationField(1, "status", "completed")
    failed.release()
    expect(overlayConversation(row({}))).toEqual(row({}))

    const done = holdConversationField(1, "status", "completed")
    done.settle()
    expect(overlayConversation(row({})).status).toBe("completed")
    vi.advanceTimersByTime(SETTLED_HOLD_MS)
    expect(overlayConversation(row({})).status).toBe("in_progress")
  })

  it("lets a newer hold on the same field replace an older one", () => {
    const first = holdConversationField(1, "title", "A")
    holdConversationField(1, "title", "B")
    first.release()
    expect(overlayConversation(row({})).title).toBe("B")
  })

  it("takes any pinned time as confirming a pin", () => {
    holdConversationField(1, "pinned_at", "2026-11-24T00:00:00.000Z")
    expect(overlayConversation(row({})).pinned_at).toBe(
      "2026-11-24T00:00:00.000Z"
    )
    const server = row({ pinned_at: "2026-11-24T00:00:01.123Z" })
    expect(overlayConversation(server)).toBe(server)
    expect(overlayConversation(row({})).pinned_at).toBeNull()
  })
})
