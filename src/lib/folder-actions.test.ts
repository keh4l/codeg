import { beforeEach, describe, expect, it, vi } from "vitest"

import type { FolderDetail } from "@/lib/types"

const api = vi.hoisted(() => ({
  updateFolderColor: vi.fn(),
  updateFolderAlias: vi.fn(),
  updateFolderDefaultAgent: vi.fn(),
  removeFolderFromWorkspace: vi.fn(),
  listAllConversations: vi.fn(async () => []),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}))

import { useAppWorkspaceStore } from "@/stores/app-workspace-store"

import {
  changeFolderColor,
  changeFolderDefaultAgent,
  setFolderAlias,
} from "./folder-actions"

function folder(id: number, patch: Partial<FolderDetail> = {}) {
  return {
    id,
    name: `f${id}`,
    path: `/f${id}`,
    kind: "regular",
    color: "default",
    alias: null,
    default_agent_type: null,
    ...patch,
  } as unknown as FolderDetail
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const shown = (id: number) =>
  useAppWorkspaceStore.getState().folders.find((f) => f.id === id)

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.listAllConversations.mockResolvedValue([])
  useAppWorkspaceStore.setState({
    folders: [folder(1), folder(2)],
    allFolders: [folder(1), folder(2), folder(3)],
    branches: new Map([[2, "main"]]),
  })
})

describe("instant folder changes", () => {
  it("changes the folder before the request, then takes the server's folder", async () => {
    const request = deferred<FolderDetail>()
    api.updateFolderColor.mockReturnValue(request.promise)
    const done = changeFolderColor(1, "blue" as never, vi.fn())

    expect(shown(1)?.color).toBe("blue")
    expect(
      useAppWorkspaceStore.getState().allFolders.find((f) => f.id === 1)?.color
    ).toBe("blue")
    request.resolve(folder(1, { color: "blue", alias: "server" }))
    expect(await done).toBe(true)
    expect(shown(1)?.alias).toBe("server")
    // One request: no re-read of the folder.
    expect(api.updateFolderColor).toHaveBeenCalledTimes(1)
  })

  it("takes a refused change back and reports it", async () => {
    api.updateFolderAlias.mockRejectedValue({
      code: "io_error",
      message: "read-only",
    })
    const onError = vi.fn()
    expect(await setFolderAlias(2, "web", onError)).toBe(false)
    expect(shown(2)?.alias).toBeNull()
    expect(onError).toHaveBeenCalledWith("read-only")
  })

  it("does not apply an older answer over a newer change", async () => {
    const first = deferred<FolderDetail>()
    api.updateFolderDefaultAgent
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(folder(1, { default_agent_type: "codex" }))
    const older = changeFolderDefaultAgent(1, "claude_code", vi.fn())
    await changeFolderDefaultAgent(1, "codex", vi.fn())
    first.resolve(folder(1, { default_agent_type: "claude_code" }))
    await older
    expect(shown(1)?.default_agent_type).toBe("codex")
  })
})

describe("closing a folder", () => {
  it("leaves the sidebar at once and comes back where it was if refused", async () => {
    const request = deferred<void>()
    api.removeFolderFromWorkspace.mockReturnValue(request.promise)
    const closing = useAppWorkspaceStore.getState().removeFolderFromWorkspace(2)
    expect(shown(2)).toBeUndefined()
    expect(useAppWorkspaceStore.getState().branches.has(2)).toBe(false)

    request.reject(new Error("busy"))
    await expect(closing).rejects.toThrow("busy")
    expect(useAppWorkspaceStore.getState().folders.map((f) => f.id)).toEqual([
      1, 2,
    ])
    expect(useAppWorkspaceStore.getState().branches.get(2)).toBe("main")
  })
})
