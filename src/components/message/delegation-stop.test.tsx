import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"

const stopDelegationTasks = vi.fn()
vi.mock("@/lib/delegation-push-api", () => ({
  stopDelegationTasks: (...args: unknown[]) => stopDelegationTasks(...args),
}))
const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }))

import {
  DelegationStopAllButton,
  DelegationStopButton,
} from "./delegation-stop"

const m = enMessages.Folder.chat.liveRuns

function wrap(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  stopDelegationTasks.mockReset()
  toastError.mockReset()
})

describe("stopping delegated sub-agents", () => {
  it("stops one task from its row", async () => {
    stopDelegationTasks.mockResolvedValue(1)
    wrap(<DelegationStopButton taskId="t-1" />)
    await userEvent.click(screen.getByRole("button", { name: m.stop }))
    expect(stopDelegationTasks).toHaveBeenCalledWith(["t-1"])
  })

  it("offers stop-all only for two or more, and stops them together", async () => {
    stopDelegationTasks.mockResolvedValue(2)
    const { rerender } = wrap(<DelegationStopAllButton taskIds={["t-1"]} />)
    expect(screen.queryByTestId("delegation-stop-all")).toBeNull()
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DelegationStopAllButton taskIds={["t-1", "t-2"]} />
      </NextIntlClientProvider>
    )
    await userEvent.click(screen.getByRole("button", { name: m.stopAll }))
    expect(stopDelegationTasks).toHaveBeenCalledWith(["t-1", "t-2"])
  })

  it("says so when the stop fails", async () => {
    stopDelegationTasks.mockRejectedValue(new Error("offline"))
    wrap(<DelegationStopButton taskId="t-1" />)
    await userEvent.click(screen.getByRole("button", { name: m.stop }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toContain("offline")
  })
})
