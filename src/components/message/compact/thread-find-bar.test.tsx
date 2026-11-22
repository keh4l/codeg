import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import type { ConversationSearchResult } from "@/lib/transcript-view-api"
import { setFindTarget } from "./compact-thread"
import {
  applyFindHighlights,
  clearFindHighlights,
  dispatchOpenThreadFind,
  shouldInterceptFindKey,
  ThreadFindBar,
} from "./thread-find-bar"

const h = vi.hoisted(() => ({
  searchConversation:
    vi.fn<
      (
        id: number,
        q: string,
        opts?: { caseSensitive?: boolean; limit?: number }
      ) => Promise<ConversationSearchResult>
    >(),
}))

vi.mock("@/lib/transcript-view-api", () => ({
  searchConversation: (
    id: number,
    q: string,
    opts?: { caseSensitive?: boolean; limit?: number }
  ) => h.searchConversation(id, q, opts),
}))

describe("shouldInterceptFindKey", () => {
  it("intercepts Cmd/Ctrl+F in conversation area, never in inputs/composer/terminal/editor", () => {
    const conv = document.createElement("div")
    const msg = document.createElement("p")
    const input = document.createElement("input")
    const editor = document.createElement("div")
    editor.className = "cm-editor"
    const editorChild = document.createElement("span")
    editor.appendChild(editorChild)
    const term = document.createElement("div")
    term.className = "xterm"
    conv.append(msg, input, editor, term)
    document.body.appendChild(conv)

    const makeEvt = (target: EventTarget) => {
      const e = new KeyboardEvent("keydown", { key: "f", ctrlKey: true })
      Object.defineProperty(e, "target", { value: target })
      return e
    }

    expect(shouldInterceptFindKey(makeEvt(msg), conv, null)).toBe(true)
    expect(shouldInterceptFindKey(makeEvt(input), conv, null)).toBe(false)
    expect(shouldInterceptFindKey(makeEvt(editorChild), conv, null)).toBe(false)
    expect(shouldInterceptFindKey(makeEvt(term), conv, null)).toBe(false)

    conv.remove()
  })
})

describe("ThreadFindBar & highlight fallback", () => {
  beforeEach(() => {
    h.searchConversation.mockReset()
    setFindTarget(null)
  })

  afterEach(() => {
    setFindTarget(null)
  })

  it("wraps matches with <mark> fallback when CSS.highlights is unavailable and clears cleanly", () => {
    const host = document.createElement("div")
    host.innerHTML =
      '<div data-turn-indices="2" data-turn-ids="t2"><p>Hello zod and ZOD</p></div>'
    document.body.appendChild(host)

    applyFindHighlights(host, "zod", false, 2, "t2", 1)
    const marks = host.querySelectorAll("mark[data-codeg-find-mark]")
    expect(marks).toHaveLength(2)
    expect(marks[1]!.getAttribute("data-codeg-find-mark")).toBe("active")

    clearFindHighlights(host)
    expect(host.querySelectorAll("mark[data-codeg-find-mark]")).toHaveLength(0)
    expect(host.textContent).toBe("Hello zod and ZOD")
    host.remove()
  })

  it("opens via event, searches server, pages unloaded history, shows 1000+ when truncated, and closes on Escape", async () => {
    const user = userEvent.setup()
    const loadOlder = vi.fn(async () => true)
    const scrollToIndex = vi.fn()
    const containerRef = { current: document.createElement("div") }
    const scrollApiRef = {
      current: { scrollToIndex, revealFromAbove: vi.fn() },
    }

    h.searchConversation.mockResolvedValue({
      matches: [
        {
          turn_index: 3,
          turn_id: "t3",
          role: "assistant",
          block: "text",
          occurrence: 0,
          snippet: "old match",
          snippet_match_start: 0,
          snippet_match_end: 3,
        },
        {
          turn_index: 10,
          turn_id: "t10",
          role: "user",
          block: "text",
          occurrence: 0,
          snippet: "new match",
          snippet_match_start: 0,
          snippet_match_end: 3,
        },
      ],
      total: 1205,
      truncated: true,
    })

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ThreadFindBar
          conversationId={42}
          isActive
          containerRef={containerRef}
          scrollApiRef={scrollApiRef}
          threadIndexByTurnIndex={new Map([[10, 1]])}
          threadIndexByTurnId={new Map([["t10", 1]])}
          localTurns={[]}
          loadOlderTurnsThrough={loadOlder}
        />
      </NextIntlClientProvider>
    )

    dispatchOpenThreadFind(42)
    const input = await screen.findByRole("textbox")
    await user.type(input, "match")

    await waitFor(() =>
      expect(h.searchConversation).toHaveBeenCalledWith(42, "match", {
        caseSensitive: false,
        limit: 1000,
      })
    )
    expect(await screen.findByText("1/1000+")).toBeTruthy()
    // First match (turn_index 3) is unloaded -> triggers loadOlderTurnsThrough
    expect(loadOlder).toHaveBeenCalledWith(42, 3)

    // Enter steps to match 2 (loaded turn 10 -> scrolls to index 1)
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() =>
      expect(scrollToIndex).toHaveBeenCalledWith(1, {
        align: "center",
        smooth: false,
      })
    )

    // Escape closes the bar
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByRole("search")).toBeNull()
  })

  it("reports whether the active turn held a match and can skip scrolling", () => {
    const host = document.createElement("div")
    host.innerHTML =
      '<div data-turn-indices="1" data-turn-ids="t1"><p>alpha</p></div>' +
      '<div data-turn-indices="2" data-turn-ids="t2"><p>beta</p></div>'
    document.body.appendChild(host)
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView")

    expect(
      applyFindHighlights(host, "beta", false, 2, "t2", 0, { scroll: false })
    ).toBe(true)
    expect(scroll).not.toHaveBeenCalled()
    // A match only outside the active turn still paints, but reports false.
    expect(applyFindHighlights(host, "alpha", false, 2, "t2", 0)).toBe(false)
    expect(host.querySelectorAll("mark[data-codeg-find-mark]")).toHaveLength(1)
    expect(applyFindHighlights(host, "gamma", false, 2, "t2", 0)).toBe(false)

    scroll.mockRestore()
    clearFindHighlights(host)
    host.remove()
  })

  it("repaints the highlight after the thread rewrites the matched text, and Enter re-jumps a single match", async () => {
    const user = userEvent.setup()
    const scrollToIndex = vi.fn()
    const container = document.createElement("div")
    container.innerHTML =
      '<div data-turn-indices="5" data-turn-ids="t5"><p>12 passed — SecretToken</p></div>'
    document.body.appendChild(container)
    const containerRef = { current: container }
    const scrollApiRef = {
      current: { scrollToIndex, revealFromAbove: vi.fn() },
    }
    h.searchConversation.mockResolvedValue({
      matches: [
        {
          turn_index: 5,
          turn_id: "t5",
          role: "assistant",
          block: "tool_output",
          occurrence: 0,
          snippet: "12 passed — SecretToken",
          snippet_match_start: 12,
          snippet_match_end: 23,
        },
      ],
      total: 1,
      truncated: false,
    })

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ThreadFindBar
          conversationId={7}
          isActive
          containerRef={containerRef}
          scrollApiRef={scrollApiRef}
          threadIndexByTurnIndex={new Map([[5, 0]])}
          threadIndexByTurnId={new Map([["t5", 0]])}
          localTurns={[]}
          loadOlderTurnsThrough={vi.fn(async () => true)}
        />
      </NextIntlClientProvider>
    )

    dispatchOpenThreadFind(7)
    const input = await screen.findByRole("textbox")
    await user.type(input, "secrettoken")
    const activeMark = () =>
      container.querySelector('mark[data-codeg-find-mark="active"]')
    await waitFor(() => expect(activeMark()?.textContent).toBe("SecretToken"))

    // React re-renders the row: the text (and the mark around it) is replaced.
    container.querySelector("p")!.textContent = "12 passed — SecretToken"
    expect(activeMark()).toBeNull()
    await waitFor(() => expect(activeMark()?.textContent).toBe("SecretToken"))

    // One match: Enter still jumps back to it.
    const jumps = scrollToIndex.mock.calls.length
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() =>
      expect(scrollToIndex.mock.calls.length).toBeGreaterThan(jumps)
    )

    fireEvent.keyDown(input, { key: "Escape" })
    expect(activeMark()).toBeNull()
    container.remove()
  })
})
