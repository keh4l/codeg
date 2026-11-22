import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import { MessageScrollProvider } from "../message-scroll-context"
import { ReplyMetaFooter } from "./reply-meta-footer"

const h = vi.hoisted(() => ({
  createTask: vi.fn(),
  toggleTranslate: vi.fn(),
  scrollToIndex: vi.fn(),
}))

vi.mock("../use-create-task-from-message", () => ({
  useCreateTaskFromMessage: () => h.createTask,
}))
vi.mock("../translation-context", () => ({
  useTurnTranslation: () => ({
    visible: true,
    translated: false,
    pending: false,
    toggle: h.toggleTranslate,
    shownReplyText: () => null,
  }),
}))
vi.mock("@/hooks/use-appearance", () => ({
  useChatAnimationsEnabled: () => false,
}))
vi.mock("../model-label-context", () => ({
  useModelLabel: () => (id: string) => id,
}))

describe("ReplyMetaFooter", () => {
  it("keeps copy, translate, fork, task, jump, model, tokens, and time intact", async () => {
    const user = userEvent.setup()
    const onFork = vi.fn()
    h.createTask.mockClear()
    h.toggleTranslate.mockClear()
    h.scrollToIndex.mockClear()

    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <MessageScrollProvider
          value={{
            scrollToIndex: h.scrollToIndex,
            revealFromAbove: vi.fn(),
          }}
        >
          <ReplyMetaFooter
            usage={{
              input_tokens: 4000,
              output_tokens: 1200,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 800,
            }}
            duration_ms={5000}
            model="claude-opus-5-5"
            previousUserIndex={2}
            copyText="Answer text"
            completedAt="2026-11-22T10:15:00Z"
            onForkFromHere={onFork}
            alwaysVisible
          />
        </MessageScrollProvider>
      </NextIntlClientProvider>
    )

    expect(
      container
        .querySelector("[data-compact-reply-footer]")
        ?.getAttribute("data-visible")
    ).toBe("true")
    expect(screen.getByText("claude-opus-5-5")).toBeTruthy()
    expect(
      screen.getByText(/6\.0k tokens|6,000 tokens|6k tokens/i)
    ).toBeTruthy()

    await user.click(screen.getByRole("button", { name: /translate/i }))
    expect(h.toggleTranslate).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: /fork/i }))
    expect(onFork).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: /create task|task/i }))
    expect(h.createTask).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: /jump/i }))
    expect(h.scrollToIndex).toHaveBeenCalledWith(2, {
      align: "start",
      smooth: false,
    })
  })
})
