"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronRight,
  Eye,
  FileCode2,
  FileDiff,
  FileIcon,
  Folder,
  FolderOpen,
  Loader2,
  X,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { VList } from "virtua"

import { useActiveFolder } from "@/contexts/active-folder-context"
import { useOpenFileTarget } from "@/hooks/use-open-file-target"
import { useArrivedOnCompletion } from "@/hooks/use-chat-motion"
import { readFilePreview, readWorkspaceFileBase64 } from "@/lib/api"
import {
  isAddedFileDiff,
  isRemovedFileDiff,
  toAbsoluteFilePath,
  toFolderRelativePath,
} from "@/lib/file-path-display"
import {
  extractReplyFileChanges,
  type FileChangeStat,
} from "@/lib/session-files"
import type { MessageTurn } from "@/lib/types"
import { cn } from "@/lib/utils"
import { MessageResponse } from "@/components/ai-elements/message"
import { CodexVisualizeCard } from "../codex-visualize-card"

export type ChangedFileStatus = "added" | "removed" | "modified"

export interface ChangedFilesDirNode {
  kind: "dir"
  /** Full path key of the directory chain (e.g. `src/auth`). */
  key: string
  /** Compressed display label (e.g. `src/auth/`). */
  name: string
  additions: number
  deletions: number
  children: ChangedFilesTreeNode[]
}

export interface ChangedFilesFileNode {
  kind: "file"
  key: string
  name: string
  displayPath: string
  file: FileChangeStat
  status: ChangedFileStatus
}

export type ChangedFilesTreeNode = ChangedFilesDirNode | ChangedFilesFileNode

export type FlatChangedFileRow =
  | { kind: "dir"; depth: number; node: ChangedFilesDirNode; open: boolean }
  | { kind: "file"; depth: number; node: ChangedFilesFileNode }

/** Up to this many changed files, expand all directories by default; above it,
 *  start collapsed so large refactors stay compact. */
export const CHANGED_FILES_DEFAULT_EXPAND_LIMIT = 8
/** Virtualize the tree body once the visible row count passes this threshold. */
export const CHANGED_FILES_VIRTUALIZE_THRESHOLD = 250

interface RawDirNode {
  name: string
  key: string
  dirs: Map<string, RawDirNode>
  files: ChangedFilesFileNode[]
}

function fileStatusOf(file: FileChangeStat): ChangedFileStatus {
  if (isRemovedFileDiff(file.diff)) return "removed"
  if (isAddedFileDiff(file.diff)) return "added"
  return "modified"
}

function finalizeDir(raw: RawDirNode): ChangedFilesDirNode {
  // Collapse single-child directory chains (e.g. `src` -> `auth` => `src/auth`).
  let cur = raw
  const segments = [cur.name]
  while (cur.files.length === 0 && cur.dirs.size === 1) {
    const only = cur.dirs.values().next().value!
    segments.push(only.name)
    cur = only
  }
  const childDirs = [...cur.dirs.values()]
    .map(finalizeDir)
    .sort((a, b) => a.name.localeCompare(b.name))
  const childFiles = [...cur.files].sort((a, b) => a.name.localeCompare(b.name))
  const children: ChangedFilesTreeNode[] = [...childDirs, ...childFiles]
  let additions = 0
  let deletions = 0
  for (const child of children) {
    if (child.kind === "dir") {
      additions += child.additions
      deletions += child.deletions
    } else {
      additions += child.file.additions
      deletions += child.file.deletions
    }
  }
  return {
    kind: "dir",
    key: cur.key,
    name: `${segments.join("/")}/`,
    additions,
    deletions,
    children,
  }
}

/**
 * Build a sorted directory tree from a reply's file changes, merging
 * single-child directory chains and summing `+additions / −deletions` up to
 * each directory row. Exported for unit tests.
 */
export function buildChangedFilesTree(
  files: readonly FileChangeStat[],
  folderPath?: string | null
): ChangedFilesTreeNode[] {
  const root: RawDirNode = { name: "", key: "", dirs: new Map(), files: [] }

  for (const file of files) {
    const displayPath = toFolderRelativePath(file.path, folderPath ?? undefined)
    const parts = displayPath.replace(/\\/g, "/").split("/").filter(Boolean)
    const fileName = parts[parts.length - 1] ?? displayPath
    const dirParts = parts.slice(0, -1)

    let cur = root
    for (const seg of dirParts) {
      const nextKey = cur.key ? `${cur.key}/${seg}` : seg
      let child = cur.dirs.get(seg)
      if (!child) {
        child = { name: seg, key: nextKey, dirs: new Map(), files: [] }
        cur.dirs.set(seg, child)
      }
      cur = child
    }

    cur.files.push({
      kind: "file",
      key: file.id || displayPath,
      name: fileName,
      displayPath,
      file,
      status: fileStatusOf(file),
    })
  }

  const dirs = [...root.dirs.values()]
    .map(finalizeDir)
    .sort((a, b) => a.name.localeCompare(b.name))
  const rootFiles = [...root.files].sort((a, b) => a.name.localeCompare(b.name))
  return [...dirs, ...rootFiles]
}

/** Flatten visible rows of a changed-files tree given a per-dir open check. */
export function flattenChangedFilesTree(
  nodes: readonly ChangedFilesTreeNode[],
  isDirOpen: (key: string) => boolean
): FlatChangedFileRow[] {
  const out: FlatChangedFileRow[] = []
  const walk = (list: readonly ChangedFilesTreeNode[], depth: number) => {
    for (const node of list) {
      if (node.kind === "dir") {
        const open = isDirOpen(node.key)
        out.push({ kind: "dir", depth, node, open })
        if (open) walk(node.children, depth + 1)
      } else {
        out.push({ kind: "file", depth, node })
      }
    }
  }
  walk(nodes, 0)
  return out
}

type PreviewKind = "html" | "markdown" | "image"

function previewKindFor(path: string): PreviewKind | null {
  const lower = path.toLowerCase()
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html"
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown"
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg")
  ) {
    return "image"
  }
  return null
}

function imageMimeFor(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  return "image/jpeg"
}

interface TreeMemory {
  allOpen: boolean
  dirs: Map<string, boolean>
}

/** Remember per-turn directory fold choices across virtualizer unmounts. */
const treeMemory = new WeakMap<MessageTurn[], TreeMemory>()

const InlineNewFilePreview = memo(function InlineNewFilePreview({
  filePath,
  displayPath,
  folderPath,
  kind,
  onClose,
}: {
  filePath: string
  displayPath: string
  folderPath?: string
  kind: PreviewKind
  onClose: () => void
}) {
  const t = useTranslations("CompactView")
  const absPath = toAbsoluteFilePath(filePath, folderPath) ?? filePath
  const [loading, setLoading] = useState(kind !== "html")
  const [error, setError] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  useEffect(() => {
    if (kind === "html") return
    let cancelled = false
    setLoading(true)
    setError(null)
    if (kind === "markdown" && folderPath) {
      readFilePreview(folderPath, displayPath)
        .then((res) => {
          if (cancelled) return
          setMarkdown(res.content ?? "")
          setLoading(false)
        })
        .catch((err) => {
          if (cancelled) return
          setError(String(err))
          setLoading(false)
        })
    } else if (kind === "image" && folderPath) {
      readWorkspaceFileBase64(folderPath, displayPath)
        .then((b64) => {
          if (cancelled) return
          setImageSrc(`data:${imageMimeFor(displayPath)};base64,${b64}`)
          setLoading(false)
        })
        .catch((err) => {
          if (cancelled) return
          setError(String(err))
          setLoading(false)
        })
    } else {
      setLoading(false)
    }
    return () => {
      cancelled = true
    }
  }, [kind, folderPath, displayPath])

  if (kind === "html") {
    return (
      <div
        className="border-t border-border/60 p-2"
        data-compact-file-preview=""
      >
        <CodexVisualizeCard path={absPath} mode="normal" onCollapse={onClose} />
      </div>
    )
  }

  return (
    <div
      className="border-t border-border/60 bg-background/60 p-3"
      data-compact-file-preview=""
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5 truncate font-mono">
          <FileCode2 className="size-3.5 shrink-0" />
          <span className="truncate">{displayPath}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closePreview")}
          className="inline-flex size-5 items-center justify-center rounded hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{t("loadingPreview")}</span>
        </div>
      ) : error ? (
        <p className="text-xs text-tone-danger">{error}</p>
      ) : kind === "markdown" && markdown !== null ? (
        <div className="max-h-72 overflow-y-auto text-sm">
          <MessageResponse>{markdown}</MessageResponse>
        </div>
      ) : kind === "image" && imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt={displayPath}
          className="max-h-72 max-w-full rounded-md border border-border/60 object-contain"
        />
      ) : null}
    </div>
  )
})

/**
 * keh4l build: T3-style changed-files tree shown under a completed assistant
 * reply in compact view (replaces `ReplyArtifacts`).
 *
 * - Sticky header with file count, total `+A −D`, and Expand/Collapse all.
 * - Single-child directory chains merged (`src/auth/`), directory sums shown.
 * - ≤8 files default expanded; >8 files default collapsed.
 * - Clicking a file opens its unified diff in the file tabs panel.
 * - Previewable new files (HTML / Markdown / images) offer an inline Preview
 *   toggle.
 * - Virtualizes automatically when >250 rows are expanded.
 */
export const ChangedFilesTree = memo(function ChangedFilesTree({
  sourceTurns,
  isResponseComplete,
}: {
  sourceTurns: MessageTurn[]
  isResponseComplete: boolean
}) {
  const t = useTranslations("CompactView")
  const tArtifacts = useTranslations("Folder.chat.replyArtifacts")
  const { activeFolder: folder } = useActiveFolder()
  const openFileTarget = useOpenFileTarget()
  const arrived = useArrivedOnCompletion(isResponseComplete)

  const files = useMemo(
    () => (isResponseComplete ? extractReplyFileChanges(sourceTurns) : []),
    [isResponseComplete, sourceTurns]
  )
  const folderPath = folder?.path

  const tree = useMemo(
    () => buildChangedFilesTree(files, folderPath),
    [files, folderPath]
  )

  const hasDirs = useMemo(() => tree.some((n) => n.kind === "dir"), [tree])

  const defaultAllOpen = files.length <= CHANGED_FILES_DEFAULT_EXPAND_LIMIT
  const [treeState, setTreeState] = useState<TreeMemory>(() => {
    const saved = treeMemory.get(sourceTurns)
    if (saved) return { allOpen: saved.allOpen, dirs: new Map(saved.dirs) }
    return { allOpen: defaultAllOpen, dirs: new Map() }
  })

  // Keep memory synced when sourceTurns changes (e.g. promoted turn).
  const [memSource, setMemSource] = useState(sourceTurns)
  if (memSource !== sourceTurns) {
    setMemSource(sourceTurns)
    const saved = treeMemory.get(sourceTurns)
    setTreeState(
      saved
        ? { allOpen: saved.allOpen, dirs: new Map(saved.dirs) }
        : { allOpen: defaultAllOpen, dirs: new Map() }
    )
  }

  const [previewKey, setPreviewKey] = useState<string | null>(null)

  const isDirOpen = useCallback(
    (key: string) => treeState.dirs.get(key) ?? treeState.allOpen,
    [treeState]
  )

  const toggleDir = useCallback(
    (key: string) => {
      setTreeState((prev) => {
        const dirs = new Map(prev.dirs)
        const current = dirs.get(key) ?? prev.allOpen
        dirs.set(key, !current)
        const next = { allOpen: prev.allOpen, dirs }
        treeMemory.set(sourceTurns, next)
        return next
      })
    },
    [sourceTurns]
  )

  const toggleAll = useCallback(() => {
    setTreeState((prev) => {
      const next: TreeMemory = { allOpen: !prev.allOpen, dirs: new Map() }
      treeMemory.set(sourceTurns, next)
      return next
    })
  }, [sourceTurns])

  const flatRows = useMemo(
    () => flattenChangedFilesTree(tree, isDirOpen),
    [tree, isDirOpen]
  )

  const replyDiffKey = sourceTurns[0]?.id ?? "reply"
  const openDiff = useCallback(
    (file: FileChangeStat) => {
      void openFileTarget(file.path, {
        diff: {
          content:
            file.diff ??
            tArtifacts("noDiffDataAvailable", { filePath: file.path }),
          groupLabel: replyDiffKey,
        },
      })
    },
    [openFileTarget, replyDiffKey, tArtifacts]
  )

  if (!isResponseComplete || files.length === 0) return null

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)
  const virtualized = flatRows.length > CHANGED_FILES_VIRTUALIZE_THRESHOLD

  const previewNode = previewKey
    ? (flatRows.find(
        (r): r is Extract<FlatChangedFileRow, { kind: "file" }> =>
          r.kind === "file" && r.node.key === previewKey
      )?.node ?? null)
    : null
  const previewKind = previewNode
    ? previewKindFor(previewNode.displayPath)
    : null

  const renderRow = (row: FlatChangedFileRow) => {
    const padStart = 10 + row.depth * 14
    if (row.kind === "dir") {
      const { node, open } = row
      return (
        <button
          key={`d:${node.key}`}
          type="button"
          data-compact-tree-dir={node.key}
          aria-expanded={open}
          onClick={() => toggleDir(node.key)}
          style={{ paddingInlineStart: padStart }}
          className="flex h-7 w-full items-center gap-1.5 pe-2.5 text-start text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              open && "rotate-90"
            )}
          />
          {open ? (
            <FolderOpen
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground/80"
            />
          ) : (
            <Folder
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground/80"
            />
          )}
          <span className="min-w-0 flex-1 truncate font-mono" dir="ltr">
            {node.name}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.6875rem] tabular-nums">
            {node.additions > 0 ? (
              <span className="text-tone-success">+{node.additions}</span>
            ) : null}
            {node.deletions > 0 ? (
              <span className="text-tone-danger">−{node.deletions}</span>
            ) : null}
          </span>
        </button>
      )
    }

    const { node } = row
    const canPreview =
      node.status === "added" && previewKindFor(node.displayPath) !== null
    const isPreviewing = previewKey === node.key

    return (
      <div
        key={`f:${node.key}`}
        data-compact-tree-file={node.displayPath}
        className="flex h-7 items-center transition-colors hover:bg-accent/40"
      >
        <button
          type="button"
          onClick={() => openDiff(node.file)}
          title={node.displayPath}
          style={{ paddingInlineStart: padStart + (hasDirs ? 16 : 0) }}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 pe-2 text-start text-xs text-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <FileIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0",
              node.status === "removed"
                ? "text-tone-danger"
                : node.status === "added"
                  ? "text-tone-success"
                  : "text-muted-foreground"
            )}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono",
              node.status === "removed" && "text-tone-danger line-through"
            )}
            dir="ltr"
          >
            {node.name}
          </span>
          {node.status === "added" ? (
            <span className="shrink-0 rounded bg-tone-success/15 px-1 py-0.5 text-[0.625rem] font-medium leading-none text-tone-success">
              {t("fileAddedBadge")}
            </span>
          ) : node.status === "removed" ? (
            <span className="shrink-0 rounded bg-tone-danger/15 px-1 py-0.5 text-[0.625rem] font-medium leading-none text-tone-danger">
              {t("fileRemovedBadge")}
            </span>
          ) : null}
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.6875rem] tabular-nums">
            {node.file.additions > 0 ? (
              <span className="text-tone-success">+{node.file.additions}</span>
            ) : null}
            {node.file.deletions > 0 ? (
              <span className="text-tone-danger">−{node.file.deletions}</span>
            ) : null}
          </span>
        </button>
        {canPreview ? (
          <button
            type="button"
            data-compact-tree-preview-btn=""
            aria-pressed={isPreviewing}
            onClick={() =>
              setPreviewKey((prev) => (prev === node.key ? null : node.key))
            }
            className={cn(
              "me-1.5 inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              isPreviewing && "bg-muted text-foreground"
            )}
          >
            <Eye aria-hidden="true" className="size-3" />
            <span>{t("previewFile")}</span>
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div
      data-compact-changed-files=""
      className={cn(
        "mt-2.5 overflow-hidden rounded-lg border border-border/80 bg-card/40 text-card-foreground",
        arrived && "chat-enter"
      )}
    >
      <div
        data-compact-tree-header=""
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-card/95 px-2.5 py-1.5 text-xs backdrop-blur-xs"
      >
        <FileDiff
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="font-medium text-foreground">
          {t("changedFilesTitle", { count: files.length })}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.6875rem] tabular-nums">
          <span className="text-tone-success">+{totalAdditions}</span>
          <span className="text-tone-danger">−{totalDeletions}</span>
        </span>
        {hasDirs ? (
          <button
            type="button"
            data-compact-tree-toggle-all=""
            onClick={toggleAll}
            className="ms-auto shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {treeState.allOpen ? t("collapseAllDirs") : t("expandAllDirs")}
          </button>
        ) : null}
      </div>

      {virtualized ? (
        <div data-compact-tree-virtualized="true" className="py-1">
          <VList style={{ height: 320 }}>
            {flatRows.map((row) => renderRow(row))}
          </VList>
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto py-1">
          {flatRows.map((row) => renderRow(row))}
        </div>
      )}

      {previewNode && previewKind ? (
        <InlineNewFilePreview
          filePath={previewNode.file.path}
          displayPath={previewNode.displayPath}
          folderPath={folderPath}
          kind={previewKind}
          onClose={() => setPreviewKey(null)}
        />
      ) : null}
    </div>
  )
})
