import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import type { QueuedMessage } from "@/hooks/use-message-queue"

import { HeldQueueBar, PendingSteers, QueuedFollowUps } from "./follow-up-queue"

const FU = enMessages.FollowUp

function item(id: string, text: string): QueuedMessage {
  return {
    id,
    draft: { blocks: [{ type: "text", text }], displayText: text },
    modeId: null,
  }
}

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>
  )
}

describe("QueuedFollowUps", () => {
  const handlers = () => ({
    onReorder: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onSendNow: vi.fn(),
  })

  it("shows each queued message with send now, edit and remove", async () => {
    const h = handlers()
    wrap(
      <QueuedFollowUps
        queue={[item("a", "add tests"), item("b", "write notes")]}
        held={false}
        running
        editingItemId={null}
        {...h}
      />
    )
    expect(screen.getByText("add tests")).toBeInTheDocument()
    expect(screen.getByText("Queued 2")).toBeInTheDocument()
    const sendNow = screen.getAllByRole("button", { name: FU.sendNow })
    expect(sendNow[0]).toHaveAttribute("title", FU.sendNowIntoTurn)
    fireEvent.click(sendNow[1])
    await waitFor(() => expect(h.onSendNow).toHaveBeenCalledWith("b"))
    fireEvent.click(screen.getAllByRole("button", { name: FU.edit })[0])
    expect(h.onEdit).toHaveBeenCalledWith("a")
    fireEvent.click(screen.getAllByRole("button", { name: FU.remove })[1])
    expect(h.onDelete).toHaveBeenCalledWith("b")
  })

  it("says paused while held, and 'start a turn' while idle", () => {
    wrap(
      <QueuedFollowUps
        queue={[item("a", "add tests")]}
        held
        running={false}
        editingItemId={null}
        {...handlers()}
      />
    )
    expect(screen.getByText("Paused · queued 1")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: FU.sendNow })).toHaveAttribute(
      "title",
      FU.sendNowAsTurn
    )
  })

  it("marks the item being edited instead of offering its actions", () => {
    wrap(
      <QueuedFollowUps
        queue={[item("a", "add tests")]}
        held={false}
        running
        editingItemId="a"
        {...handlers()}
      />
    )
    expect(screen.getByText(FU.editingInComposer)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: FU.sendNow })).toBeNull()
  })

  it("collapses a long queue", () => {
    wrap(
      <QueuedFollowUps
        queue={["1", "2", "3", "4", "5"].map((n) => item(n, `msg ${n}`))}
        held={false}
        running
        editingItemId={null}
        {...handlers()}
      />
    )
    expect(screen.queryByText("msg 4")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }))
    expect(screen.getByText("msg 5")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: FU.showFewer })
    ).toBeInTheDocument()
  })

  it("renders nothing for an empty queue", () => {
    const { container } = wrap(
      <QueuedFollowUps
        queue={[]}
        held={false}
        running
        editingItemId={null}
        {...handlers()}
      />
    )
    expect(container.textContent).toBe("")
  })
})

describe("HeldQueueBar / PendingSteers", () => {
  it("lets a held queue go", () => {
    const onResume = vi.fn()
    wrap(<HeldQueueBar count={2} onResume={onResume} />)
    expect(
      screen.getByText("Queue paused · 2 messages waiting")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: FU.resume }))
    expect(onResume).toHaveBeenCalled()
  })

  it("shows a steer on its way as waiting to be read", () => {
    wrap(
      <PendingSteers
        steers={[
          {
            id: "s1",
            conversationId: 1,
            how: "restart",
            text: "use env.ts",
            status: "pending",
            createdAt: "2026-11-22T00:00:00Z",
          },
        ]}
      />
    )
    expect(screen.getByText("use env.ts")).toBeInTheDocument()
    expect(screen.getByText(FU.steerPending)).toBeInTheDocument()
  })
})
