import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import type {
  AdaptedContentPart,
  UserImageDisplay,
} from "@/lib/adapters/ai-elements-adapter"
import { CompactThreadProvider } from "./compact-thread"
import { CompactUserBubble } from "./user-bubble"

vi.mock("../use-create-task-from-message", () => ({
  useCreateTaskFromMessage: () => vi.fn(),
}))
vi.mock("../translation-context", () => ({
  useSentOriginal: () => ({ original: null, showing: false, toggle: vi.fn() }),
}))

function wrap(ui: React.ReactNode, onEditUserMessage?: (text: string) => void) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CompactThreadProvider
        value={{
          round: { open: false, setOpen: () => {} },
          liveMessage: null,
          onEditUserMessage,
        }}
      >
        {ui}
      </CompactThreadProvider>
    </NextIntlClientProvider>
  )
}

function makeImg(n: number): UserImageDisplay {
  return { name: `img-${n}.png`, mime_type: "image/png", data: "AAAA" }
}

describe("CompactUserBubble", () => {
  it("applies grouped corner radii and invokes edit-in-composer", async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const parts: AdaptedContentPart[] = [{ type: "text", text: "Fix login" }]

    const { container } = render(
      wrap(
        <CompactUserBubble
          parts={parts}
          images={[]}
          resources={[]}
          timestamp="2026-11-22T10:05:00Z"
          groupPos="middle"
        />,
        onEdit
      )
    )

    const bubble = container.querySelector("[data-compact-user-bubble]")!
    expect(bubble.className).toContain("rounded-tr-md")
    expect(bubble.className).toContain("rounded-br-md")

    const editBtn = screen.getByRole("button", { name: /edit in composer/i })
    await user.click(editBtn)
    expect(onEdit).toHaveBeenCalledWith("Fix login")
  })

  it("renders a media collage with +N overflow when more than 4 images are attached", () => {
    const imgs = [1, 2, 3, 4, 5, 6].map(makeImg)
    render(
      wrap(
        <CompactUserBubble
          parts={[{ type: "text", text: "Screenshots" }]}
          images={imgs}
          resources={[]}
        />
      )
    )

    expect(screen.getByText("+2")).toBeTruthy()
    expect(screen.getAllByRole("img")).toHaveLength(4)
  })

  it("folds only when natural height exceeds 22rem and toggles back open", async () => {
    const user = userEvent.setup()
    const origScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    )
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.hasAttribute("data-compact-user-text") ? 420 : 0
      },
    })
    try {
      const { container } = render(
        wrap(
          <CompactUserBubble
            parts={[{ type: "text", text: "Very long prompt" }]}
            images={[]}
            resources={[]}
          />
        )
      )
      const textBox = container.querySelector("[data-compact-user-text]")!
      expect(textBox.getAttribute("data-clipped")).toBe("true")
      expect(textBox.className).toContain("max-h-44")

      const toggle = container.querySelector(
        "[data-compact-user-fold-toggle]"
      ) as HTMLButtonElement
      expect(toggle).not.toBeNull()
      await user.click(toggle)
      expect(textBox.getAttribute("data-clipped")).toBeNull()
    } finally {
      if (origScrollHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          origScrollHeight
        )
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
      }
    }
  })
})
