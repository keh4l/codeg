import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import type { ConversationMinimapEntry } from "@/lib/transcript-view-api"
import {
  TimelineMinimap,
  __resetMinimapCacheForTests,
} from "./timeline-minimap"

const h = vi.hoisted(() => ({
  getConversationMinimap: vi.fn<() => Promise<ConversationMinimapEntry[]>>(
    async () => []
  ),
}))

vi.mock("@/lib/transcript-view-api", () => ({
  getConversationMinimap: () => h.getConversationMinimap(),
}))

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe("TimelineMinimap", () => {
  beforeEach(() => {
    h.getConversationMinimap.mockReset()
    __resetMinimapCacheForTests()
  })

  it("stays hidden when fewer than 2 user turns exist", async () => {
    h.getConversationMinimap.mockResolvedValue([
      {
        turn_index: 0,
        turn_id: "u0",
        timestamp: "2026-11-22T10:00:00Z",
        prompt: "Only one",
        reply: "Answer",
      },
    ])

    const { container } = render(
      wrap(
        <TimelineMinimap
          conversationId={1}
          turnsOffset={10}
          prefixHash="p10"
          localTurns={[]}
          activeTurnId="u0"
          onJump={vi.fn()}
        />
      )
    )

    await waitFor(() => expect(h.getConversationMinimap).toHaveBeenCalled())
    expect(container.querySelector("[data-compact-minimap]")).toBeNull()
  })

  it("asks the server once per conversation, and not at all for a whole history", async () => {
    h.getConversationMinimap.mockResolvedValue([])
    const props = { localTurns: [], activeTurnId: null, onJump: vi.fn() }
    const view = render(
      wrap(
        <TimelineMinimap
          conversationId={2}
          turnsOffset={0}
          prefixHash={null}
          {...props}
        />
      )
    )
    // The loaded turns are the whole history.
    expect(h.getConversationMinimap).not.toHaveBeenCalled()

    view.rerender(
      wrap(
        <TimelineMinimap
          conversationId={2}
          turnsOffset={40}
          prefixHash="p40"
          {...props}
        />
      )
    )
    await waitFor(() =>
      expect(h.getConversationMinimap).toHaveBeenCalledTimes(1)
    )
    // Older pages loading in, a remount: the list already covers them.
    view.rerender(
      wrap(
        <TimelineMinimap
          conversationId={2}
          turnsOffset={20}
          prefixHash="p20"
          {...props}
        />
      )
    )
    view.unmount()
    render(
      wrap(
        <TimelineMinimap
          conversationId={2}
          turnsOffset={40}
          prefixHash="p40"
          {...props}
        />
      )
    )
    await Promise.resolve()
    expect(h.getConversationMinimap).toHaveBeenCalledTimes(1)
  })

  it("asks again when the window starts later or the history before it changed", async () => {
    h.getConversationMinimap.mockResolvedValue([])
    const props = { localTurns: [], activeTurnId: null, onJump: vi.fn() }
    const view = render(
      wrap(
        <TimelineMinimap
          conversationId={3}
          turnsOffset={40}
          prefixHash="a"
          {...props}
        />
      )
    )
    await waitFor(() =>
      expect(h.getConversationMinimap).toHaveBeenCalledTimes(1)
    )
    view.rerender(
      wrap(
        <TimelineMinimap
          conversationId={3}
          turnsOffset={40}
          prefixHash="b"
          {...props}
        />
      )
    )
    await waitFor(() =>
      expect(h.getConversationMinimap).toHaveBeenCalledTimes(2)
    )
    view.rerender(
      wrap(
        <TimelineMinimap
          conversationId={3}
          turnsOffset={60}
          prefixHash="c"
          {...props}
        />
      )
    )
    await waitFor(() =>
      expect(h.getConversationMinimap).toHaveBeenCalledTimes(3)
    )
  })

  it("shows glass preview on hover and jumps to clicked turn", async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    h.getConversationMinimap.mockResolvedValue([
      {
        turn_index: 0,
        turn_id: "u0",
        timestamp: "2026-11-22T10:00:00Z",
        prompt: "Migrate login to zod",
        reply: "Created loginSchema and updated form.",
      },
      {
        turn_index: 4,
        turn_id: "u4",
        timestamp: "2026-11-22T10:05:00Z",
        prompt: "Add confirm password",
        reply: null,
      },
    ])

    render(
      wrap(
        <TimelineMinimap
          conversationId={1}
          turnsOffset={10}
          prefixHash="p10"
          localTurns={[]}
          activeTurnId="u4"
          onJump={onJump}
        />
      )
    )

    const ticks = await screen.findAllByRole("button")
    expect(ticks).toHaveLength(2)
    expect(ticks[1]!.getAttribute("data-active")).toBe("true")

    fireEvent.mouseEnter(ticks[0]!)
    expect(screen.getByText("Migrate login to zod")).toBeTruthy()
    expect(
      screen.getByText("Created loginSchema and updated form.")
    ).toBeTruthy()

    await user.click(ticks[0]!)
    expect(onJump).toHaveBeenCalledWith({ turnIndex: 0, turnId: "u0" })
  })
})
