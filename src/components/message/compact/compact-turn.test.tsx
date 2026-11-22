import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { writeChatViewPrefs } from "@/lib/chat-view-prefs"
import { resetDisclosureStore } from "../activity/disclosure-store"
import {
  CompactThreadProvider,
  setFindTarget,
  useCompactRound,
} from "./compact-thread"
import { CompactTurn } from "./compact-turn"

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-md">{children}</div>
  ),
}))
vi.mock("@/components/ai-elements/reasoning", () => ({
  ReasoningMarkdown: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-reasoning">{children}</div>
  ),
}))

function toolPart(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
  opts: {
    output?: string
    state?:
      | "input-streaming"
      | "input-available"
      | "output-available"
      | "output-error"
    errorText?: string
  } = {}
): AdaptedContentPart {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input: JSON.stringify(input),
    output: opts.output ?? "ok",
    state: opts.state ?? "output-available",
    errorText: opts.errorText,
  }
}

function Host({
  roundKey = "r1",
  children,
}: {
  roundKey?: string
  children: React.ReactNode
}) {
  const round = useCompactRound(roundKey)
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CompactThreadProvider value={{ round, liveMessage: null }}>
        {children}
      </CompactThreadProvider>
    </NextIntlClientProvider>
  )
}

describe("CompactTurn", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetDisclosureStore()
    setFindTarget(null)
    writeChatViewPrefs({ view: "compact", toolVisibility: "showAll" })
  })

  afterEach(() => {
    setFindTarget(null)
    window.localStorage.clear()
  })

  it("folds finished replies automatically and reveals steps on click", async () => {
    const user = userEvent.setup()
    const parts: AdaptedContentPart[] = [
      toolPart("r1", "Read", { file_path: "src/login.tsx" }),
      toolPart("c1", "Bash", { command: "pnpm test" }, { output: "12 passed" }),
      { type: "text", text: "All tests pass." },
    ]

    const { container } = render(
      <Host>
        <CompactTurn parts={parts} durationMs={15_000} completed />
      </Host>
    )

    // Folded by default: Worked line + answer visible, steps hidden
    const foldBtn = container.querySelector(
      "[data-compact-fold]"
    ) as HTMLButtonElement
    expect(foldBtn).not.toBeNull()
    expect(foldBtn.getAttribute("aria-expanded")).toBe("false")
    expect(foldBtn.textContent).toContain("15s")
    expect(screen.getByText("All tests pass.")).toBeTruthy()
    expect(screen.queryByText(/pnpm test/)).toBeNull()

    // Click expands flat activity rows (reusing upstream ActivityParts)
    await user.click(foldBtn)
    expect(foldBtn.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText(/pnpm test/)).toBeTruthy()
  })

  it("keeps unrecovered failures visible outside a folded turn", () => {
    const parts: AdaptedContentPart[] = [
      toolPart("r1", "Read", { file_path: "src/login.tsx" }),
      toolPart(
        "c1",
        "Bash",
        { command: "pnpm lint" },
        { state: "output-error", errorText: "exit 1" }
      ),
      { type: "text", text: "Lint still has an error." },
    ]

    const { container } = render(
      <Host>
        <CompactTurn parts={parts} durationMs={12_000} completed />
      </Host>
    )

    expect(
      container
        .querySelector("[data-compact-fold]")
        ?.getAttribute("aria-expanded")
    ).toBe("false")
    // Unrecovered failure stays visible outside the fold
    expect(screen.getByText(/pnpm lint/)).toBeTruthy()
  })

  it("does not auto-fold a live turn the user manually expanded before completion", async () => {
    const user = userEvent.setup()
    const streamingParts: AdaptedContentPart[] = [
      {
        type: "reasoning",
        content: "Checking login validation",
        isStreaming: true,
      },
      toolPart("r1", "Read", { file_path: "src/login.tsx" }),
    ]

    const { container, rerender } = render(
      <Host roundKey="round-1">
        <CompactTurn parts={streamingParts} completed={false} currentRound />
      </Host>
    )

    const workingBtn = container.querySelector(
      "[data-compact-working]"
    ) as HTMLButtonElement
    expect(workingBtn).not.toBeNull()
    await user.click(workingBtn)
    expect(container.querySelector("[data-compact-live-scroll]")).not.toBeNull()

    // Now finish the reply in the same round: stays expanded!
    const doneParts: AdaptedContentPart[] = [
      ...streamingParts,
      { type: "text", text: "Finished." },
    ]
    rerender(
      <Host roundKey="round-1">
        <CompactTurn
          parts={doneParts}
          durationMs={8_000}
          completed
          currentRound
        />
      </Host>
    )

    expect(
      container
        .querySelector("[data-compact-fold]")
        ?.getAttribute("aria-expanded")
    ).toBe("true")
  })

  it("does not fold a tool-only reply with no visible answer", () => {
    const parts: AdaptedContentPart[] = [
      toolPart("c1", "Bash", { command: "pnpm build" }),
    ]

    const { container } = render(
      <Host>
        <CompactTurn parts={parts} durationMs={5_000} completed />
      </Host>
    )

    // Fold header is non-interactive div (not a toggle button) and step stays visible
    expect(container.querySelector("button[data-compact-fold]")).toBeNull()
    expect(screen.getByText(/pnpm build/)).toBeTruthy()
  })

  it("hides the fold line in zen mode and unfolds when targeted by find", () => {
    writeChatViewPrefs({ view: "compact", toolVisibility: "zen" })
    const parts: AdaptedContentPart[] = [
      toolPart(
        "c1",
        "Bash",
        { command: "pnpm test" },
        { output: "secret-needle-output" }
      ),
      { type: "text", text: "Done." },
    ]

    const { container, rerender } = render(
      <Host>
        <CompactTurn
          parts={parts}
          durationMs={9_000}
          completed
          turnIds={["turn-9"]}
          turnIndices={[9]}
        />
      </Host>
    )

    // Zen mode: no fold line, only final answer
    expect(container.querySelector("[data-compact-fold]")).toBeNull()
    expect(screen.getByText("Done.")).toBeTruthy()
    expect(screen.queryByText(/pnpm test/)).toBeNull()

    // Find targets this turn: unfolds and exposes the tool row
    setFindTarget({
      query: "secret-needle",
      caseSensitive: false,
      turnIndex: 9,
      turnIds: new Set(["turn-9"]),
      block: "tool_output",
      token: 1,
    })
    rerender(
      <Host>
        <CompactTurn
          parts={parts}
          durationMs={9_000}
          completed
          turnIds={["turn-9"]}
          turnIndices={[9]}
        />
      </Host>
    )

    expect(screen.getByText(/pnpm test/)).toBeTruthy()
  })
})
