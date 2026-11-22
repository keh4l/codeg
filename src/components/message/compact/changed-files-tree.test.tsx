import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import type { FileChangeStat } from "@/lib/session-files"
import type { MessageTurn } from "@/lib/types"
import {
  buildChangedFilesTree,
  ChangedFilesTree,
  flattenChangedFilesTree,
} from "./changed-files-tree"

const h = vi.hoisted(() => ({
  openFileTarget: vi.fn(async () => {}),
  extractReplyFileChanges: vi.fn<() => FileChangeStat[]>(() => []),
}))

vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: { id: 1, path: "/repo" } }),
}))
vi.mock("@/hooks/use-open-file-target", () => ({
  useOpenFileTarget: () => h.openFileTarget,
}))
vi.mock("@/hooks/use-chat-motion", () => ({
  useArrivedOnCompletion: () => false,
}))
vi.mock("@/lib/session-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-files")>()
  return {
    ...actual,
    extractReplyFileChanges: () => h.extractReplyFileChanges(),
  }
})
vi.mock("virtua", () => ({
  VList: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-vlist">{children}</div>
  ),
}))

function makeFile(
  path: string,
  additions: number,
  deletions: number,
  diff = `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new`
): FileChangeStat {
  return { id: path, path, additions, deletions, diff }
}

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe("buildChangedFilesTree", () => {
  it("merges single-child directory chains and sums directory counts", () => {
    const files = [
      makeFile("/repo/src/auth/schema.ts", 20, 5),
      makeFile("/repo/src/auth/login.ts", 10, 2),
      makeFile("/repo/package.json", 1, 1),
    ]
    const tree = buildChangedFilesTree(files, "/repo")
    expect(tree).toHaveLength(2)
    expect(tree[0]).toMatchObject({
      kind: "dir",
      name: "src/auth/",
      additions: 30,
      deletions: 7,
    })
    expect(tree[1]).toMatchObject({ kind: "file", name: "package.json" })

    const expanded = flattenChangedFilesTree(tree, () => true)
    expect(expanded.map((r) => r.node.name)).toEqual([
      "src/auth/",
      "login.ts",
      "schema.ts",
      "package.json",
    ])
  })
})

describe("ChangedFilesTree component", () => {
  const dummyTurns: MessageTurn[] = [
    {
      id: "turn-1",
      role: "assistant",
      blocks: [],
      timestamp: "2026-11-22T10:00:00Z",
    },
  ]

  it("expands by default for <=8 files, opens diff panel on click, and shows preview for new HTML/md", async () => {
    const user = userEvent.setup()
    h.openFileTarget.mockClear()
    h.extractReplyFileChanges.mockReturnValue([
      makeFile(
        "/repo/src/auth/report.html",
        40,
        0,
        "--- /dev/null\n+++ b/src/auth/report.html\n@@ -0,0 +1 @@\n+<h1>hi</h1>"
      ),
      makeFile("/repo/src/auth/login.ts", 5, 2),
    ])

    render(
      wrap(<ChangedFilesTree sourceTurns={dummyTurns} isResponseComplete />)
    )

    // <= 8 files: directory is expanded by default so files are immediately visible
    expect(screen.getByText("login.ts")).toBeTruthy()
    expect(screen.getByText("report.html")).toBeTruthy()
    expect(screen.getByText("New")).toBeTruthy()
    expect(screen.getByRole("button", { name: /preview/i })).toBeTruthy()

    await user.click(screen.getByText("login.ts"))
    expect(h.openFileTarget).toHaveBeenCalledWith(
      "/repo/src/auth/login.ts",
      expect.objectContaining({
        diff: expect.objectContaining({ groupLabel: "turn-1" }),
      })
    )

    // Collapse all hides files inside src/auth/
    await user.click(screen.getByRole("button", { name: /collapse all/i }))
    expect(screen.queryByText("login.ts")).toBeNull()
  })

  it("starts collapsed when >8 files and virtualizes when >250 rows are expanded", async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 260 }, (_, i) =>
      makeFile(`/repo/src/mod${Math.floor(i / 20)}/file-${i}.ts`, 1, 0)
    )
    h.extractReplyFileChanges.mockReturnValue(many)

    const { container } = render(
      wrap(<ChangedFilesTree sourceTurns={dummyTurns} isResponseComplete />)
    )

    // > 8 files: starts collapsed
    expect(screen.queryByText("file-0.ts")).toBeNull()

    await user.click(screen.getByRole("button", { name: /expand all/i }))
    expect(
      container.querySelector('[data-compact-tree-virtualized="true"]')
    ).not.toBeNull()
  })
})
