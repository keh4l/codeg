import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import type { ReactElement } from "react"
import { afterEach, describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import { adaptMessageTurn } from "@/lib/adapters/ai-elements-adapter"
import {
  recordAttachedResults,
  resetDelegationResultsLive,
} from "@/lib/delegation-results-live"
import type { DelegationResultsTask, MessageTurn } from "@/lib/types"
import {
  DelegationResultsAttached,
  DelegationResultsRows,
  isDelegationResultsGroup,
  withoutDelegationResults,
} from "./delegation-results-row"

const m = enMessages.Folder.chat.delegationResults

function task(
  overrides: Partial<DelegationResultsTask> = {}
): DelegationResultsTask {
  return {
    task_id: "9f3a1c22-0000-4000-8000-000000000000",
    agent_type: "codex",
    status: "completed",
    duration_ms: 94_000,
    preview: "Fixed the flaky test in auth.spec.ts",
    child_conversation_id: 512,
    ...overrides,
  }
}

function wrap(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

const text = { toolCallFailed: "failed" } as Parameters<
  typeof adaptMessageTurn
>[1]

function adapted(turn: MessageTurn) {
  return adaptMessageTurn(turn, text).content
}

afterEach(() => resetDelegationResultsLive())

describe("delegation results", () => {
  it("adapts the block and recognizes a results-only group", () => {
    const parts = adapted({
      id: "turn-3",
      role: "system",
      timestamp: "2026-11-21T00:00:00Z",
      blocks: [
        { type: "delegation_results", id: "n1", mode: "wake", tasks: [task()] },
      ],
    })
    expect(parts).toEqual([
      { type: "delegation-results", id: "n1", mode: "wake", tasks: [task()] },
    ])
    expect(isDelegationResultsGroup({ parts })).toBe(true)
    expect(isDelegationResultsGroup({ parts: [] })).toBe(false)
  })

  it("keeps the same parts array when no results rode along", () => {
    const parts = [{ type: "text" as const, text: "hi" }]
    expect(withoutDelegationResults(parts)).toBe(parts)
    const withResults = [
      ...parts,
      {
        type: "delegation-results" as const,
        id: "n1",
        mode: "attached" as const,
        tasks: [task()],
      },
    ]
    expect(withoutDelegationResults(withResults)).toEqual(parts)
  })

  it("draws a wake as one row that opens to each task", async () => {
    const user = userEvent.setup()
    wrap(
      <DelegationResultsRows
        parts={[
          {
            type: "delegation-results",
            id: "n1",
            mode: "wake",
            tasks: [
              task(),
              task({
                task_id: "b2",
                status: "failed",
                resumable: true,
                preview: "network dropped",
              }),
            ],
          },
        ]}
      />
    )
    expect(screen.getByText(m.heading.wake)).toBeInTheDocument()
    expect(screen.getByText(/#9f3a1c done · 1m 34s/)).toBeInTheDocument()
    expect(screen.getByText(/\+1 more/)).toBeInTheDocument()
    expect(screen.queryByTestId("delegation-results-task")).toBeNull()
    await user.click(screen.getByRole("button", { expanded: false }))
    expect(screen.getAllByTestId("delegation-results-task")).toHaveLength(2)
    expect(screen.getByText("network dropped")).toBeInTheDocument()
    expect(screen.getByText(/interrupted \(can resume\)/)).toBeInTheDocument()
    expect(screen.getByText(m.footnote)).toBeInTheDocument()
  })

  it("tags a user message with the results that rode along, live and reloaded", () => {
    const turns: MessageTurn[] = [
      {
        id: "optimistic-1",
        role: "user",
        timestamp: "2026-11-21T00:00:00Z",
        blocks: [],
      },
    ]
    const { rerender } = wrap(
      <DelegationResultsAttached parts={[]} sourceTurns={turns} />
    )
    expect(screen.queryByTestId("delegation-results-attached")).toBeNull()
    act(() => {
      recordAttachedResults("optimistic-1", {
        id: "n2",
        mode: "attached",
        tasks: [task()],
      })
    })
    expect(screen.getByText("1 subtask result attached")).toBeInTheDocument()
    // Reloaded: the persisted turn carries the same task; it is listed once.
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DelegationResultsAttached
          parts={[
            {
              type: "delegation-results",
              id: "n2",
              mode: "attached",
              tasks: [task()],
            },
          ]}
          sourceTurns={turns}
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByText("1 subtask result attached")).toBeInTheDocument()
  })
})
