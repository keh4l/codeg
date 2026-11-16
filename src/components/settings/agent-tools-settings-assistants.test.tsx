// keh4l build: the "Create assistants" row of Collaboration → In-conversation
// tools. On by default; read off the codeg-mcp tool groups and saved through
// the same writer as the status-bar popover.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  getFeedbackSettings: vi.fn(async () => ({ enabled: false })),
  setFeedbackSettings: vi.fn(),
  getQuestionSettings: vi.fn(async () => ({ enabled: true })),
  setQuestionSettings: vi.fn(),
  getSessionInfoSettings: vi.fn(async () => ({ enabled: true })),
  setSessionInfoSettings: vi.fn(),
  getBrowserToolsSettings: vi.fn(async () => ({ enabled: false, eval: false })),
  setBrowserToolsSettings: vi.fn(),
  getChatAuthoringSettings: vi.fn(async () => ({
    automations_enabled: false,
    work_tasks_enabled: false,
  })),
  setChatAuthoringSettings: vi.fn(),
  getCodegMcpServiceStatus: vi.fn(),
  setCodegMcpToolGroup: vi.fn(async () => undefined),
}))
vi.mock("@/lib/computer/computer-api", () => ({
  getComputerToolsSettings: vi.fn(async () => ({ enabled: false })),
  setComputerToolsEnabled: vi.fn(),
  useComputerAvailable: () => false,
}))
vi.mock("@/lib/image-gen/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-gen/api")>()),
  getImageGenSettings: vi.fn(async () => ({ enabled: false })),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const handlers = new Map<string, (p: unknown) => void>()
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn((event: string, handler: (p: unknown) => void) => {
    handlers.set(event, handler)
    return Promise.resolve(() => {})
  }),
}))
vi.mock("@/hooks/use-feedback-enabled", () => ({
  primeFeedbackEnabled: vi.fn(),
}))

import { AgentToolsSettingsSection } from "./agent-tools-settings"
import enMessages from "@/i18n/messages/en.json"
import { getCodegMcpServiceStatus, setCodegMcpToolGroup } from "@/lib/api"
import { ASSISTANT_TOOLS_SETTINGS_CHANGED_EVENT } from "@/lib/assistant-tools-api"

const LABEL = enMessages.AgentTools.assistants.label

function status(groups: Array<{ key: string; enabled: boolean }>) {
  return {
    state: "running" as const,
    listening: true,
    socket_path: "",
    binary_path: null,
    tool_groups: groups,
    companion_count: 0,
    session_count: 0,
    active_delegations: 0,
    depth_limit: 3,
    started_at: null,
    last_error: null,
    can_start: true,
  }
}

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AgentToolsSettingsSection />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(setCodegMcpToolGroup).mockClear()
  vi.mocked(getCodegMcpServiceStatus).mockReset()
  handlers.clear()
})

describe("the create-assistants row", () => {
  it("reads its group and saves it alone", async () => {
    vi.mocked(getCodegMcpServiceStatus).mockResolvedValue(
      status([
        { key: "image", enabled: false },
        { key: "assistants", enabled: true },
      ])
    )
    renderSection()

    const toggle = await screen.findByLabelText(LABEL)
    await waitFor(() => expect(toggle).toHaveAttribute("data-state", "checked"))
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(setCodegMcpToolGroup).toHaveBeenCalledWith("assistants", false)
    )
    expect(setCodegMcpToolGroup).toHaveBeenCalledTimes(1)
  })

  it("reads on when the backend reports no such group", async () => {
    vi.mocked(getCodegMcpServiceStatus).mockResolvedValue(status([]))
    renderSection()
    const toggle = await screen.findByLabelText(LABEL)
    await waitFor(() => expect(toggle).toHaveAttribute("data-state", "checked"))
  })

  it("follows a toggle made elsewhere", async () => {
    vi.mocked(getCodegMcpServiceStatus).mockResolvedValue(
      status([{ key: "assistants", enabled: true }])
    )
    renderSection()

    const toggle = await screen.findByLabelText(LABEL)
    await waitFor(() =>
      expect(handlers.has(ASSISTANT_TOOLS_SETTINGS_CHANGED_EVENT)).toBe(true)
    )
    act(() =>
      handlers.get(ASSISTANT_TOOLS_SETTINGS_CHANGED_EVENT)!({ enabled: false })
    )
    expect(toggle).toHaveAttribute("data-state", "unchecked")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })
})
