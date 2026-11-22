import { describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import type {
  ResolvedMessageGroup,
  ThreadRenderItem,
} from "@/components/message/message-list-view"
import type { FollowUpSteerRecord } from "@/lib/follow-up/api"

import {
  buildSteerLookup,
  findInterruptedReplies,
  InterruptedAttemptFold,
  normalizeSteerText,
} from "./follow-up-marks"

function group(
  id: string,
  role: ResolvedMessageGroup["role"],
  text: string
): ResolvedMessageGroup {
  return {
    id,
    role,
    parts: [{ type: "text", text }] as ResolvedMessageGroup["parts"],
    resources: [],
    images: [],
  }
}

function turn(g: ResolvedMessageGroup): ThreadRenderItem {
  return {
    key: `${g.role}-${g.id}`,
    kind: "turn",
    group: g,
  } as unknown as ThreadRenderItem
}

function record(
  text: string,
  how: FollowUpSteerRecord["how"],
  status: FollowUpSteerRecord["status"] = "sent"
): FollowUpSteerRecord {
  return {
    id: `s-${text}`,
    conversationId: 1,
    how,
    text,
    status,
    createdAt: "2026-11-22T00:00:00Z",
  }
}

describe("buildSteerLookup", () => {
  it("matches user turns by their text, whitespace-insensitively", () => {
    const lookup = buildSteerLookup([record("use  env.ts\n", "native")])
    expect(lookup.find(group("u1", "user", "use env.ts"))?.how).toBe("native")
    expect(lookup.find(group("u2", "user", "something else"))).toBeNull()
    // Assistant turns never carry a steer mark.
    expect(lookup.find(group("a1", "assistant", "use env.ts"))).toBeNull()
  })

  it("finds a steer the agent echoed with framing around it", () => {
    const lookup = buildSteerLookup([record("add the tests too", "native")])
    expect(
      lookup.find(group("u1", "user", "<queued>add the tests too</queued>"))
    ).not.toBeNull()
  })

  it("ignores steers that never reached the turn", () => {
    const lookup = buildSteerLookup([
      record("dropped", "restart", "undelivered"),
      record("requeued", "restart", "requeued"),
    ])
    expect(lookup.find(group("u1", "user", "dropped"))).toBeNull()
    expect(lookup.find(group("u2", "user", "requeued"))).toBeNull()
  })

  it("normalizes text", () => {
    expect(normalizeSteerText("  a \n\t b ")).toBe("a b")
  })
})

describe("findInterruptedReplies", () => {
  it("folds the replies right before a restart steer, back to the previous user turn", () => {
    const items = [
      turn(group("u1", "user", "set the timeout to 30s")),
      turn(group("a1", "assistant", "editing config.ts")),
      turn(group("a2", "assistant", "still editing")),
      turn(group("u2", "user", "use env.ts")),
      turn(group("a3", "assistant", "done in env.ts")),
    ]
    const keys = findInterruptedReplies(
      items,
      (g) => g.role === "user" && g.id === "u2"
    )
    expect([...keys]).toEqual(["assistant-a2", "assistant-a1"])
  })

  it("folds nothing without a predicate", () => {
    expect(findInterruptedReplies([], null).size).toBe(0)
  })
})

describe("InterruptedAttemptFold", () => {
  it("is collapsed until opened", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <InterruptedAttemptFold>
          <p>partial reply</p>
        </InterruptedAttemptFold>
      </NextIntlClientProvider>
    )
    expect(screen.queryByText("partial reply")).toBeNull()
    fireEvent.click(
      screen.getByRole("button", {
        name: enMessages.FollowUp.interruptedAttempt,
      })
    )
    expect(screen.getByText("partial reply")).toBeInTheDocument()
  })
})
