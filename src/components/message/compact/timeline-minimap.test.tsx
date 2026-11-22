import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import type { ConversationMinimapEntry } from "@/lib/transcript-view-api"
import { TimelineMinimap } from "./timeline-minimap"

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
          refreshKey="k1"
          localTurns={[]}
          activeTurnId="u0"
          onJump={vi.fn()}
        />
      )
    )

    await waitFor(() => expect(h.getConversationMinimap).toHaveBeenCalled())
    expect(container.querySelector("[data-compact-minimap]")).toBeNull()
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
          refreshKey="k1"
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
