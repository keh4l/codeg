import { useState, type ReactElement } from "react"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import {
  StaticConnectionStoreProvider,
  type ConnectionStoreApi,
} from "@/contexts/acp-connections-context"
import {
  StaticDelegationProvider,
  type DelegationContextValue,
} from "@/contexts/delegation-context"
import {
  StaticWorkspaceActionsProvider,
  type WorkspaceActionsValue,
} from "@/contexts/workspace-context"
import {
  adaptMessageTurn,
  type AdaptedContentPart,
} from "@/lib/adapters/ai-elements-adapter"
import {
  MOCKUP_ADAPTER_TEXT,
  toolResult,
  toolUse,
} from "@/lib/activity/__fixtures__/mockup-turn"
import type { ContentBlock, MessageTurn } from "@/lib/types"
import { __resetToolBodiesForTests } from "@/lib/tool-bodies"
import { CompletedTurnContent } from "../completed-turn-content"
import { ActivityLiveProvider } from "./activity-live-context"
import { resetDisclosureStore } from "./disclosure-store"

const { getBlobText } = vi.hoisted(() => ({ getBlobText: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getBlobText,
}))

const STORE: ConnectionStoreApi = {
  getConnection: () => undefined,
  getConnectPending: () => undefined,
  getConnectError: () => undefined,
  getActiveKey: () => null,
  subscribeKey: () => () => {},
  subscribeActiveKey: () => () => {},
}
const DELEGATION: DelegationContextValue = {
  findByParentToolUseId: () => undefined,
  findByChildConversationId: () => undefined,
  findByTaskId: () => undefined,
  bindingsForParent: () => [],
}
const WORKSPACE = new Proxy(
  {},
  { get: () => () => {} }
) as unknown as WorkspaceActionsValue

function Round({ parts }: { parts: AdaptedContentPart[] }) {
  const [open, setOpen] = useState(true)
  return (
    <CompletedTurnContent
      parts={parts}
      durationMs={60000}
      completed
      currentRound
      roundOpen={open}
      onRoundOpenChange={setOpen}
    />
  )
}

function renderUi(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StaticConnectionStoreProvider store={STORE}>
        <StaticDelegationProvider value={DELEGATION}>
          <StaticWorkspaceActionsProvider value={WORKSPACE}>
            <ActivityLiveProvider
              value={{
                awaitingToolCallId: null,
                awaitingUser: false,
                approvals: {},
              }}
            >
              {ui}
            </ActivityLiveProvider>
          </StaticWorkspaceActionsProvider>
        </StaticDelegationProvider>
      </StaticConnectionStoreProvider>
    </NextIntlClientProvider>
  )
}

function parts(blocks: ContentBlock[]): AdaptedContentPart[] {
  const turn: MessageTurn = {
    id: "t",
    role: "assistant",
    timestamp: "2026-11-23T10:00:00Z",
    blocks: [...blocks, { type: "text", text: "Done." }],
  }
  return adaptMessageTurn(turn, MOCKUP_ADAPTER_TEXT, false).content
}

const FULL = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join("\n")
const SHORT = ["line 1", "line 2", "…", "line 999", "line 1000"].join("\n")
const REF = { id: "d".repeat(32), bytes: FULL.length, extra_lines: 995 }

function shortenedCommand(): ContentBlock[] {
  const result = toolResult("c1", SHORT)
  return [
    toolUse("c1", "Bash", { command: "cat build.log" }),
    { ...result, body_refs: { output_preview: REF } } as ContentBlock,
  ]
}

function rowOf(text: string): HTMLElement {
  const row = screen.getAllByText(text)[0]!.closest("li")
  if (!row) throw new Error(`no row for ${text}`)
  return row as HTMLElement
}

beforeEach(() => {
  resetDisclosureStore()
  __resetToolBodiesForTests()
  getBlobText.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("a shortened tool body", () => {
  it("counts the lines it left out, says so when opened and loads the rest", async () => {
    getBlobText.mockResolvedValue(FULL)
    renderUi(<Round parts={parts(shortenedCommand())} />)
    const row = rowOf("cat build.log")
    fireEvent.click(within(row).getByRole("button", { name: /cat build.log/ }))

    expect(within(row).getByText("1,000 lines")).toBeTruthy()
    const notice = within(row).getByTestId("tool-body-notice")
    expect(notice.textContent).toContain("Shortened to its start and end")
    expect(within(row).queryByText(/line 500\b/)).toBeNull()

    fireEvent.click(within(notice).getByRole("button", { name: "Load full" }))
    await waitFor(() =>
      expect(within(row).queryByTestId("tool-body-notice")).toBeNull()
    )
    expect(getBlobText).toHaveBeenCalledExactlyOnceWith(REF.id)
    expect(row.textContent).toContain("line 500")
    expect(within(row).getByText("1,000 lines")).toBeTruthy()
  })

  it("keeps the shortened body when the full one cannot be had", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    getBlobText.mockRejectedValue({ code: "not_found" })
    renderUi(<Round parts={parts(shortenedCommand())} />)
    const row = rowOf("cat build.log")
    fireEvent.click(within(row).getByRole("button", { name: /cat build.log/ }))
    fireEvent.click(within(row).getByRole("button", { name: "Load full" }))
    await waitFor(() =>
      expect(within(row).getByText("Couldn't load the full text.")).toBeTruthy()
    )
    expect(within(row).getByRole("button", { name: "Try again" })).toBeTruthy()
    expect(row.textContent).toContain("line 999")
  })

  it("says nothing on a body sent whole", () => {
    renderUi(
      <Round
        parts={parts([
          toolUse("c1", "Bash", { command: "pnpm lint" }),
          toolResult("c1", "ok\nall good"),
        ])}
      />
    )
    const row = rowOf("pnpm lint")
    fireEvent.click(within(row).getByRole("button", { name: /pnpm lint/ }))
    expect(within(row).queryByTestId("tool-body-notice")).toBeNull()
  })
})
