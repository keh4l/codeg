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

  it("folds a finished reply into its working line, then opens group lines, then steps", async () => {
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

    // Folded by default: "Worked for 15s" + answer, nothing of the steps.
    const foldBtn = container.querySelector(
      "[data-compact-fold]"
    ) as HTMLButtonElement
    expect(foldBtn).not.toBeNull()
    expect(foldBtn.getAttribute("aria-expanded")).toBe("false")
    expect(foldBtn.textContent).toContain("Worked for 15s")
    // T3 Code's fold line carries only its time: no step or diff counts.
    expect(foldBtn.textContent).not.toMatch(/step|file/i)
    expect(screen.getByText("All tests pass.")).toBeTruthy()
    expect(screen.queryByText(/pnpm test/)).toBeNull()

    // Opening it shows the group's summary line, not every step.
    await user.click(foldBtn)
    expect(foldBtn.getAttribute("aria-expanded")).toBe("true")
    const groupRow = container.querySelector(
      "[data-compact-group-row]"
    ) as HTMLButtonElement
    expect(groupRow.textContent).toContain("Ran 1 command, read 1 file")
    expect(screen.queryByText(/pnpm test/)).toBeNull()

    // Opening the group lists its steps in their box.
    await user.click(groupRow)
    expect(groupRow.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector("[data-compact-group-list]")).not.toBeNull()
    expect(screen.getByText(/pnpm test/)).toBeTruthy()
  })

  it("names a finished group in one line and keeps prose between groups", async () => {
    const user = userEvent.setup()
    const parts: AdaptedContentPart[] = [
      toolPart("r1", "Read", { file_path: "src/a.ts" }),
      toolPart("r2", "Read", { file_path: "src/b.ts" }),
      toolPart("s1", "Grep", { pattern: "loginSchema" }),
      { type: "text", text: "Switching to zod." },
      toolPart("c1", "Bash", { command: "pnpm lint" }),
      { type: "text", text: "Done." },
    ]
    const { container } = render(
      <Host>
        <CompactTurn parts={parts} durationMs={4_000} completed />
      </Host>
    )
    await user.click(
      container.querySelector("[data-compact-fold]") as HTMLButtonElement
    )
    const rows = [
      ...container.querySelectorAll("[data-compact-group-row]"),
    ].map((row) => row.textContent)
    expect(rows).toEqual(["Read 2 files, searched once"])
    // The note between the groups stays in place; a one-step group is that
    // step's own row.
    expect(screen.getByText("Switching to zod.")).toBeTruthy()
    expect(screen.getByText(/pnpm lint/)).toBeTruthy()
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

  it("shows the step under way as a live line, and keeps the reply open when its group was opened", async () => {
    const user = userEvent.setup()
    const streamingParts: AdaptedContentPart[] = [
      toolPart("r1", "Read", { file_path: "src/login.tsx" }),
      toolPart(
        "c1",
        "Bash",
        { command: "pnpm test" },
        { state: "input-available", output: undefined }
      ),
    ]

    const { container, rerender } = render(
      <Host roundKey="round-1">
        <CompactTurn parts={streamingParts} completed={false} currentRound />
      </Host>
    )

    // The working line is a clock, nothing to click.
    const working = container.querySelector("[data-compact-working]")
    expect(working?.tagName).toBe("DIV")
    expect(working?.textContent).toContain("Working for")
    const liveRow = container.querySelector(
      "[data-compact-live-row]"
    ) as HTMLButtonElement
    expect(liveRow.textContent).toContain("pnpm test")
    expect(container.querySelector("[data-compact-group-list]")).toBeNull()

    await user.click(liveRow)
    expect(container.querySelector("[data-compact-group-list]")).not.toBeNull()

    // Now finish the reply in the same round: it stays open for the reader.
    const doneParts: AdaptedContentPart[] = [
      toolPart("r1", "Read", { file_path: "src/login.tsx" }),
      toolPart("c1", "Bash", { command: "pnpm test" }, { output: "ok" }),
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

  it("says the agent is thinking while no step is under way", () => {
    const parts: AdaptedContentPart[] = [
      toolPart("r1", "Read", { file_path: "src/login.tsx" }),
    ]
    const { container } = render(
      <Host>
        <CompactTurn parts={parts} completed={false} />
      </Host>
    )
    expect(container.querySelector("[data-compact-live-row]")).toBeNull()
    expect(
      container.querySelector("[data-compact-thinking]")?.textContent
    ).toBeTruthy()
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
