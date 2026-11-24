"use client"

import { lazy, memo, Suspense, useCallback, useState } from "react"
import {
  Check,
  ChevronRight,
  Circle,
  EllipsisVertical,
  Eye,
  Info,
  Pencil,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react"
import { useTranslations } from "next-intl"
import {
  TOOL_CALL_VISIBILITIES,
  useChatViewPrefs,
  writeChatViewPrefs,
} from "@/lib/chat-view-prefs"
import { dispatchOpenThreadFind } from "@/components/message/compact/thread-find-bar"
import { useImeGuard } from "@/hooks/use-ime-guard"
import { toast } from "sonner"
import {
  deleteConversationNow,
  renameConversation,
  setConversationPinned,
  setConversationStatus,
} from "@/lib/conversation-actions"
import { formatConversationTitle } from "@/lib/conversation-title"
import {
  useConversationTitleLocked,
  useTranslatedTitle,
} from "@/hooks/use-translated-title"
import { ConversationHeaderFolderPicker } from "@/components/chat/conversation-context-bar"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabActions } from "@/contexts/tab-context"
import { getRuntimeSession } from "@/stores/conversation-runtime-store"
import type { ConversationStatus } from "@/lib/types"
import { STATUS_ORDER } from "@/lib/types"
import { ConversationStatusDot } from "@/components/conversations/conversation-status-dot"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  resolveActiveSessionDetails,
  type ActiveSessionDetails,
} from "./active-session-details"
import { SessionDetailsDialog } from "./session-details-dialog"
import { ConversationHeaderTags } from "./conversation-tag-picker"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  DeleteConversationWorktreeOption,
  takeChosenDelegationWorktree,
} from "./delete-conversation-worktree-option"

// Phones only (fork-only, keh4l/codeg#10). Loaded on demand: desktop never
// renders it, and it reads the ACP connection store, which the header itself
// does not depend on.
const OpenSessionsSwitcher = lazy(() =>
  import("./open-sessions-switcher").then((m) => ({
    default: m.OpenSessionsSwitcher,
  }))
)

interface ConversationDetailHeaderProps {
  tabId: string
  /** Persisted DB id — null for an unsaved draft (rename / pin / status /
   *  details / delete disabled until the first send persists the row). */
  conversationId: number | null
  /** Virtual runtime key a new conversation streams under before it reconciles
   *  to `conversationId`; used to resolve live session details. */
  runtimeConversationId: number | null
  folderId: number
  folderPath: string | undefined
  title: string
  status: ConversationStatus | undefined
}

/**
 * Conversation detail header (desktop only): the owning folder name + the
 * conversation title on the left; an overflow (⋯) menu on the right. A single
 * instance renders fixed above the tile scroll area, scoped to the ACTIVE
 * conversation, so it never scrolls horizontally when many conversations are
 * tiled.
 *
 * The ⋯ menu mirrors the sidebar conversation card's right-click menu (new /
 * rename / pin / details / status / delete) so the two entry points stay
 * consistent, wired to the same APIs. Subscriptions are kept narrow — a
 * primitive `pinned_at != null` boolean — so the header never re-renders on
 * streaming tokens; details data is read on demand at click time via
 * `getRuntimeSession` / store `getState`.
 */
export const ConversationDetailHeader = memo(function ConversationDetailHeader({
  tabId,
  conversationId,
  runtimeConversationId,
  folderId,
  folderPath,
  title,
  status,
}: ConversationDetailHeaderProps) {
  const t = useTranslations("Folder.conversationCard")
  const tSidebar = useTranslations("Folder.sidebar")
  const ime = useImeGuard()
  const tConv = useTranslations("Folder.conversation")
  const tStatus = useTranslations("Folder.statusLabels")
  const tDetails = useTranslations("Folder.sessionDetails")
  const tCompact = useTranslations("CompactView")
  const tAppearance = useTranslations("AppearanceSettings.chatView")
  const chatViewPrefs = useChatViewPrefs()
  const { closeTab, openNewConversationTab } = useTabActions()
  // A brand-new (draft-origin) conversation keeps streaming under its virtual
  // runtime key even after it persists — its DB row exists, but the live
  // session (detail/turns) stays keyed by `runtimeConversationId`. So details
  // must target that key; the runtime store resolves the fetchable DB id from
  // it. Rename/pin/status/delete act on `conversationId` (the DB row).
  const runtimeId = runtimeConversationId ?? conversationId
  // Narrow reactive read: a primitive-derived boolean that doesn't change on
  // streaming tokens, so the header stays inert mid-turn.
  const isPinned = useAppWorkspaceStore(
    (s) =>
      conversationId != null &&
      (s.conversations.find((c) => c.id === conversationId)?.pinned_at ??
        null) != null
  )
  // Tags: offered only on a ROOT conversation of the sidebar list — the same
  // rows the sidebar lets you tag (a sub-session opened in a tab is not one).
  // Both reads are narrow: a boolean, and the row's own `tag_ids` array, whose
  // reference only changes when its tags do.
  const taggable = useAppWorkspaceStore(
    (s) =>
      conversationId != null &&
      s.conversations.some((c) => c.id === conversationId)
  )
  const tagIds = useAppWorkspaceStore((s) =>
    conversationId == null
      ? undefined
      : s.conversations.find((c) => c.id === conversationId)?.tag_ids
  )
  const gitBranch = useAppWorkspaceStore((s) =>
    conversationId == null
      ? null
      : (s.conversations.find((c) => c.id === conversationId)?.git_branch ??
        null)
  )
  const isMobile = useIsMobile()

  const [details, setDetails] = useState<ActiveSessionDetails | null>(null)
  // Snapshot the action target when a dialog OPENS. The header is a SINGLE
  // instance reused across active tabs (see conversation-detail-panel), and the
  // global tab-switch / close-tab shortcuts still fire while a dialog is open —
  // so a rename/delete confirm must act on the conversation the dialog was
  // opened for, not whatever happens to be active at confirm time.
  const [renameTarget, setRenameTarget] = useState<{
    id: number
    title: string
  } | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number
    tabId: string
    title: string
  } | null>(null)

  const persisted = conversationId != null
  // In the reply language when replies are auto-translated; display only.
  // Renaming still starts from the stored title.
  const displayTitle =
    useTranslatedTitle(
      formatConversationTitle(title),
      useConversationTitleLocked(conversationId)
    ) || t("untitledConversation")

  const handleTogglePin = useCallback(() => {
    if (conversationId == null) return
    const next = !isPinned
    // Instantly reorders the sidebar row; the upsert echo brings the server
    // `pinned_at` (keh4l build: taken back with a toast if refused).
    void setConversationPinned(conversationId, next, (message) =>
      toast.error(tSidebar("toasts.pinConversationFailed", { message }))
    )
  }, [conversationId, isPinned, tSidebar])

  const handleNewConversation = useCallback(() => {
    if (!folderPath) return
    // Keep the active agent when the folder has no pinned default (matches the
    // panel's right-click "new conversation").
    openNewConversationTab(folderId, folderPath, { inheritFromActive: true })
  }, [folderId, folderPath, openNewConversationTab])

  const handleRenameOpen = useCallback(() => {
    if (conversationId == null) return
    setRenameValue(title || "")
    setRenameTarget({ id: conversationId, title })
  }, [conversationId, title])

  // keh4l build: rename, status and delete change the row at once and take
  // it back with a toast if the server refuses (`conversation-actions`); the
  // server's broadcast replaces the list re-read.
  const handleRenameConfirm = useCallback(() => {
    if (renameTarget == null) return
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== renameTarget.title) {
      void renameConversation(renameTarget.id, trimmed, (message) =>
        toast.error(tSidebar("toasts.renameConversationFailed", { message }))
      )
    }
    setRenameTarget(null)
  }, [renameTarget, renameValue, tSidebar])

  const handleStatusChange = useCallback(
    (next: ConversationStatus) => {
      if (conversationId == null) return
      void setConversationStatus(conversationId, next, (message) =>
        toast.error(tSidebar("toasts.conversationStatusFailed", { message }))
      )
    },
    [conversationId, tSidebar]
  )

  const handleDeleteOpen = useCallback(() => {
    if (conversationId == null) return
    setDeleteTarget({ id: conversationId, tabId, title: displayTitle })
  }, [conversationId, tabId, displayTitle])

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget == null) return
    const { id, tabId: targetTabId } = deleteTarget
    // keh4l build: the delegation worktree goes once the server has deleted
    // the conversation, when the user said so (taken now: closing clears it).
    const removeWorktree = takeChosenDelegationWorktree(id)
    void deleteConversationNow(
      id,
      // Close its tab at once. Not recorded for reopen: there is no longer a
      // conversation to reopen.
      () => closeTab(targetTabId, { recordForReopen: false }),
      (message) =>
        toast.error(tSidebar("toasts.deleteConversationFailed", { message }))
    ).then((deleted) => {
      if (deleted) void removeWorktree?.()
    })
    setDeleteTarget(null)
  }, [deleteTarget, closeTab, tSidebar])

  const handleOpenDetails = useCallback(() => {
    // Resolve on demand (no reactive whole-session subscription) via the same
    // helper the panel uses; `runtimeId` covers the virtual-key case.
    if (runtimeId == null) return
    const session = getRuntimeSession(runtimeId)
    const conversations = useAppWorkspaceStore.getState().conversations
    const resolved = resolveActiveSessionDetails(
      {
        conversationId,
        runtimeConversationId: runtimeConversationId ?? undefined,
      },
      (id) => (id === runtimeId ? session : null),
      conversations
    )
    if (!resolved.summary) return
    setDetails(resolved)
  }, [conversationId, runtimeConversationId, runtimeId])

  const plainTitle = (
    <span
      className="min-w-0 max-w-max flex-1 truncate text-sm text-foreground/90"
      title={title}
    >
      {displayTitle}
    </span>
  )

  return (
    // Transparent (no surface class): the title header reads as part of the
    // message canvas below it rather than as a frosted chrome band. With a
    // workspace background image on, the tab strip above it is transparent too,
    // so the whole top of the column reveals the canvas.
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {/* Folder selector — replaces the old folder-name breadcrumb. Switches
            folders for a draft; a static chip for a bound conversation. */}
        <ConversationHeaderFolderPicker tabId={tabId} />
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
          aria-hidden
        />
        {/* The title takes the ellipsis, so the folder crumb on the left stays
            fully visible — but grows only as far as its own text
            (`max-w-max`), so the tags follow it instead of the far edge.
            Phones have no tab strip, so there it is the open-tab switcher
            (fork-only, keh4l/codeg#10), with the plain title standing in
            while its chunk loads. */}
        {isMobile ? (
          <Suspense fallback={plainTitle}>
            <OpenSessionsSwitcher title={displayTitle} />
          </Suspense>
        ) : (
          plainTitle
        )}
        {/* Capped at half the row so a long tag list squeezes its own chips
            (they truncate) before it squeezes the title. */}
        {taggable && conversationId != null ? (
          <div className="flex max-w-[50%] min-w-0 shrink items-center">
            <ConversationHeaderTags
              conversationId={conversationId}
              folderId={folderId}
              tagIds={tagIds}
              gitBranch={gitBranch}
              max={isMobile ? 1 : 3}
            />
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground"
              aria-label={tConv("moreActions")}
              title={tConv("moreActions")}
            >
              <EllipsisVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!folderPath}
              onSelect={handleNewConversation}
            >
              <SquarePen className="h-4 w-4" />
              {t("newConversation")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!persisted} onSelect={handleRenameOpen}>
              <Pencil className="h-4 w-4" />
              {t("rename")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!persisted} onSelect={handleTogglePin}>
              {isPinned ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
              {isPinned ? t("unpin") : t("pin")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!persisted}
              onSelect={handleOpenDetails}
            >
              <Info className="h-4 w-4" />
              {tDetails("menuLabel")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!persisted}
              onSelect={() => dispatchOpenThreadFind(conversationId)}
            >
              <Search className="h-4 w-4" />
              {tCompact("findInConversation")}
            </DropdownMenuItem>
            {chatViewPrefs.view === "compact" ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Eye className="h-4 w-4" />
                  {tAppearance("toolVisibilityTitle")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {TOOL_CALL_VISIBILITIES.map((level) => (
                    <DropdownMenuItem
                      key={level}
                      onSelect={() =>
                        writeChatViewPrefs({ toolVisibility: level })
                      }
                    >
                      <Check
                        className={
                          chatViewPrefs.toolVisibility === level
                            ? "h-4 w-4 opacity-100"
                            : "h-4 w-4 opacity-0"
                        }
                      />
                      {tAppearance(`toolVisibility.${level}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!persisted}>
                <Circle className="h-4 w-4" />
                {t("status")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {STATUS_ORDER.filter((s) => s !== status).map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onSelect={() => handleStatusChange(s)}
                  >
                    <ConversationStatusDot status={s} />
                    {tStatus(s)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={!persisted}
              onSelect={handleDeleteOpen}
            >
              <Trash2 className="h-4 w-4" />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={renameTarget != null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameConversation")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return
              if (e.key === "Enter") handleRenameConfirm()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleRenameConfirm}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConversationTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConversationDescription", {
                title: deleteTarget?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <DeleteConversationWorktreeOption
            conversationId={deleteTarget?.id}
            open={deleteTarget != null}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {details?.summary && (
        <SessionDetailsDialog
          open
          onOpenChange={(o) => {
            if (!o) setDetails(null)
          }}
          summary={details.summary}
          stats={details.stats}
          model={details.model}
        />
      )}
    </div>
  )
})
