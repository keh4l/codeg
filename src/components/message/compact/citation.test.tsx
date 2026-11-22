import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import {
  citationFingerprint,
  createCitationItem,
  hasUserMessageCitations,
  parseUserMessageCitations,
  prependCitationsToText,
  serializeCitation,
} from "./citation"
import {
  CitationCard,
  CitationJumpProvider,
  ComposerCitationChips,
} from "./citation-card"

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe("citation serialization & parsing", () => {
  it("round-trips single and multi-line citations and preserves body text", () => {
    const item = createCitationItem("line one\nline two", { turnIndex: 7 })!
    const md = prependCitationsToText([item], "Please adjust this rule")
    expect(md).toContain(`[引用](codeg-cite:7/${item.fingerprint})`)
    expect(md).toContain("> line one\n> line two")
    expect(hasUserMessageCitations(md)).toBe(true)

    const blocks = parseUserMessageCitations(md)
    expect(blocks).toEqual([
      {
        kind: "citation",
        turnIndex: 7,
        fingerprint: item.fingerprint,
        text: "line one\nline two",
      },
      { kind: "text", text: "Please adjust this rule" },
    ])
  })

  it("handles multiple citations and leaves ordinary blockquotes untouched", () => {
    const c1 = serializeCitation(
      {
        turnIndex: 2,
        fingerprint: citationFingerprint("alpha"),
        text: "alpha",
      },
      "Quote"
    )
    const c2 = serializeCitation(
      {
        turnIndex: null,
        fingerprint: citationFingerprint("beta"),
        text: "beta",
      },
      "Quote"
    )
    const combined = `${c1}\n\n${c2}\n\n> plain quote\n\nmy question`
    const parsed = parseUserMessageCitations(combined)
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toMatchObject({
      kind: "citation",
      turnIndex: 2,
      text: "alpha",
    })
    expect(parsed[1]).toMatchObject({
      kind: "citation",
      turnIndex: null,
      text: "beta",
    })
    expect(parsed[2]).toEqual({
      kind: "text",
      text: "> plain quote\n\nmy question",
    })
    expect(hasUserMessageCitations("> just a normal quote")).toBe(false)
  })
})

describe("CitationCard & ComposerCitationChips", () => {
  it("jumps back on click and degrades to static card when source turn is missing", async () => {
    const user = userEvent.setup()
    const onJump = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const cite = {
      kind: "citation" as const,
      turnIndex: 4,
      fingerprint: "abc123",
      text: "quoted answer passage",
    }

    render(
      wrap(
        <CitationJumpProvider onJump={onJump}>
          <CitationCard citation={cite} />
        </CitationJumpProvider>
      )
    )

    const btn = screen.getByRole("button", { name: /jump to quoted message/i })
    await user.click(btn)
    expect(onJump).toHaveBeenCalledWith(cite)

    // Second click resolves false -> switches to non-clickable div
    await user.click(btn)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("quoted answer passage")).toBeTruthy()
  })

  it("expands and removes pending chips in the composer", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const c1 = createCitationItem("short excerpt", { turnIndex: 1 })!

    render(wrap(<ComposerCitationChips citations={[c1]} onRemove={onRemove} />))

    const expandBtn = screen.getByRole("button", { name: "short excerpt" })
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false")
    await user.click(expandBtn)
    expect(expandBtn.getAttribute("aria-expanded")).toBe("true")

    await user.click(screen.getByRole("button", { name: /remove quote/i }))
    expect(onRemove).toHaveBeenCalledWith(c1.id)
  })
})
