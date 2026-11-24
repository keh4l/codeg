import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const callMock = vi.fn<(command: string, args?: unknown) => Promise<unknown>>()

vi.mock("@/lib/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transport")>()),
  getTransport: () => ({ call: callMock }),
  isDesktop: () => false,
  isRemoteDesktopMode: () => false,
}))

import * as api from "@/lib/api"
import {
  bridgeStatus,
  resetBridgeStatusForTests,
} from "@/lib/browser/browser-bridge"
import { askComputerServed } from "@/lib/computer/computer-api"
import { harnessStatus } from "@/lib/harness/api"
import { getAppUpdateState, getServerUpdateStatus } from "@/lib/updater"

import {
  BOOT_PREFETCH_CALLS,
  PRIMED_FOR_MS,
  __resetPrimedCallsForTests,
  callKey,
  dropPrimedCalls,
  primedValue,
  takePrimedCall,
  type BootPrefetch,
} from "./boot-prefetch"

type BootWindow = { __CODEG_BOOT__?: BootPrefetch }

function prime(results: unknown[] | null, at = Date.now()) {
  ;(window as unknown as BootWindow).__CODEG_BOOT__ = {
    at,
    calls: BOOT_PREFETCH_CALLS.map((call) => ({ ...call })),
    batch: Promise.resolve(results),
  }
}

function resultsFor(make: (cmd: string) => unknown) {
  return BOOT_PREFETCH_CALLS.map(({ cmd }) => make(cmd))
}

beforeEach(() => {
  __resetPrimedCallsForTests()
  callMock.mockReset()
  callMock.mockResolvedValue({})
})
afterEach(() => {
  delete (window as unknown as BootWindow).__CODEG_BOOT__
  resetBridgeStatusForTests()
})

describe("BOOT_PREFETCH_CALLS", () => {
  it("asks exactly as the workspace's own calls do", async () => {
    await Promise.all([
      api.listOpenFolderDetails(),
      api.listAllFolderDetails(),
      api.listFolderGroups(),
      api.listAllConversations(),
      api.listOpenedTabs(),
      api.getTabSyncSettings(),
      api.listConversationTags(),
      api.getConversationBranchTag(),
      api.assistantList(),
      api.getSystemTerminalSettings(),
      api.getTranslationSettings(),
      api.getSystemLanguageSettings(),
      api.workTaskList(),
      api.automationList(),
      harnessStatus().catch(() => null),
      bridgeStatus(),
      api.getCodegMcpServiceStatus(),
      getServerUpdateStatus(),
      getAppUpdateState(),
      askComputerServed(),
    ])

    const made = new Set(
      callMock.mock.calls.map(([cmd, args]) =>
        callKey(cmd, args as Record<string, unknown> | undefined)
      )
    )
    for (const call of BOOT_PREFETCH_CALLS) {
      expect(made, call.cmd).toContain(callKey(call.cmd, call.args))
    }
  })
})

describe("takePrimedCall", () => {
  it("answers each primed call once, by command and arguments", async () => {
    prime(resultsFor((cmd) => ({ s: 200, b: cmd })))
    const hit = takePrimedCall("list_all_conversations", {
      includeChildren: null,
      status: null,
      sortBy: null,
      search: null,
      agentType: null,
      folderIds: null,
    })
    expect(await hit).toEqual({ s: 200, b: "list_all_conversations" })
    expect(
      takePrimedCall("list_all_conversations", {
        folderIds: null,
        agentType: null,
        search: null,
        sortBy: null,
        status: null,
        includeChildren: null,
      })
    ).toBeNull()

    expect(await takePrimedCall("list_opened_tabs", undefined)).toEqual({
      s: 200,
      b: "list_opened_tabs",
    })
    expect(takePrimedCall("work_task_list", { folderId: 3 })).toBeNull()
    expect(takePrimedCall("get_folder", {})).toBeNull()
  })

  it("answers null for every call when the batch failed", async () => {
    prime(null)
    expect(await takePrimedCall("list_folder_groups", {})).toBeNull()
  })

  it("is not used once it is old or the socket is ready", () => {
    prime(
      resultsFor(() => ({ s: 200, b: 1 })),
      Date.now() - PRIMED_FOR_MS - 1
    )
    expect(takePrimedCall("list_folder_groups", {})).toBeNull()

    __resetPrimedCallsForTests()
    prime(resultsFor(() => ({ s: 200, b: 1 })))
    dropPrimedCalls()
    expect(takePrimedCall("list_folder_groups", {})).toBeNull()
  })

  it("does nothing without a head script", () => {
    expect(takePrimedCall("list_folder_groups", {})).toBeNull()
  })
})

describe("primedValue", () => {
  it("uses only a success", () => {
    expect(primedValue({ s: 200, b: [1] })).toEqual({ value: [1] })
    expect(primedValue({ s: 200, b: null })).toEqual({ value: null })
    expect(primedValue({ s: 200, t: "[2]" })).toEqual({ value: [2] })
    expect(primedValue({ s: 200, t: "<html>" })).toBeNull()
    expect(primedValue({ s: 500, b: { code: "x" } })).toBeNull()
    expect(primedValue({ s: 401, w: 'Bearer realm="codeg"' })).toBeNull()
    expect(primedValue({ d: true })).toBeNull()
    expect(primedValue(null)).toBeNull()
  })
})
