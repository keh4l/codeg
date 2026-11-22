"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUpToLine,
  CheckIcon,
  CopyIcon,
  Languages,
  ListTodo,
  Loader2,
  Split,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useMessageScroll } from "@/components/message/message-scroll-context"
import { useModelLabel } from "@/components/message/model-label-context"
import { useTurnTranslation } from "@/components/message/translation-context"
import { useCreateTaskFromMessage } from "@/components/message/use-create-task-from-message"
import { useChatAnimationsEnabled } from "@/hooks/use-appearance"
import { formatTokenCount } from "@/lib/token-format"
import type { TurnUsage } from "@/lib/types"
import { cn, copyTextToClipboard } from "@/lib/utils"

export interface ReplyMetaFooterProps {
  usage?: TurnUsage | null
  duration_ms?: number | null
  model?: string | null
  models?: string[]
  previousUserIndex?: number | null
  isResponseComplete?: boolean
  copyText?: string
  replyTexts?: string[]
  thinkingTexts?: string[]
  completedAt?: string | null
  onForkFromHere?: () => void
  forkDisabled?: boolean
  forkDisabledReason?: "busy" | "unnamed"
  /** The last reply in the thread keeps its footer visible without hover. */
  alwaysVisible?: boolean
  /** Touch devices reveal the footer on tapping the reply. */
  touchRevealed?: boolean
}

const EMPTY_TEXTS: string[] = []

const compactActionClass =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * keh4l build: the compact view's reply footer. Keeps every action from
 * upstream `TurnStats` (copy, create task, translate, fork, jump to user,
 * model, token breakdown, completed time) in a quiet, hover-revealed strip
 * (always visible on the thread's last reply, or when tapped on touch).
 */
export const ReplyMetaFooter = memo(function ReplyMetaFooter({
  usage,
  duration_ms,
  model,
  models,
  previousUserIndex,
  isResponseComplete = true,
  copyText = "",
  replyTexts = EMPTY_TEXTS,
  thinkingTexts = EMPTY_TEXTS,
  completedAt,
  onForkFromHere,
  forkDisabled = false,
  forkDisabledReason = "busy",
  alwaysVisible = false,
  touchRevealed = false,
}: ReplyMetaFooterProps) {
  const locale = useLocale()
  const t = useTranslations("Folder.chat.messageList")
  const tTasks = useTranslations("Tasks")
  const scroll = useMessageScroll()
  const chatAnimations = useChatAnimationsEnabled()
  const modelLabel = useModelLabel()
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number>(0)
  const translation = useTurnTranslation(replyTexts, thinkingTexts)

  const shortTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale]
  )
  const fullTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium",
      }),
    [locale]
  )

  const completedAtDate = useMemo(() => {
    if (!isResponseComplete || !completedAt) return null
    const ms = new Date(completedAt).getTime()
    return Number.isNaN(ms) ? null : new Date(ms)
  }, [completedAt, isResponseComplete])
  const completedLabel = completedAtDate
    ? shortTimeFormatter.format(completedAtDate)
    : null
  const completedTooltip = completedAtDate
    ? fullTimeFormatter.format(completedAtDate)
    : null

  const displayModels = (models?.length ? models : model ? [model] : []).map(
    (id) => modelLabel(id) ?? id
  )
  const hasCopy = copyText.trim().length > 0
  const hasUsage = Boolean(usage)
  const totalTokens =
    usage != null
      ? usage.input_tokens +
        usage.output_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens
      : 0
  const hasTokenCounts = totalTokens > 0
  const hasDuration = typeof duration_ms === "number" && duration_ms > 0
  const hasCompletedAt = Boolean(completedLabel)
  const hasJump =
    isResponseComplete &&
    (hasUsage || hasDuration) &&
    typeof previousUserIndex === "number" &&
    Boolean(scroll?.scrollToIndex)

  const handleJump = useCallback(() => {
    if (typeof previousUserIndex !== "number") return
    scroll?.scrollToIndex(previousUserIndex, {
      align: "start",
      smooth: chatAnimations,
    })
  }, [previousUserIndex, scroll, chatAnimations])

  const getTaskText = useCallback(() => copyText ?? "", [copyText])
  const handleCreateTask = useCreateTaskFromMessage(getTaskText)

  const { shownReplyText } = translation
  const handleCopy = useCallback(async () => {
    if (isCopied || !hasCopy) return
    window.clearTimeout(timeoutRef.current)
    const ok = await copyTextToClipboard(shownReplyText() ?? copyText)
    if (!ok) return
    setIsCopied(true)
    timeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000)
  }, [copyText, hasCopy, isCopied, shownReplyText])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    []
  )

  if (!isResponseComplete) return null
  if (
    !hasCopy &&
    !hasUsage &&
    !hasCompletedAt &&
    !hasJump &&
    !onForkFromHere &&
    !translation.visible
  ) {
    return null
  }

  const pinned =
    alwaysVisible ||
    touchRevealed ||
    translation.translated ||
    translation.pending

  return (
    <div
      data-compact-reply-footer=""
      data-visible={pinned ? "true" : undefined}
      className={cn(
        "compact-reply-footer mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground",
        pinned && "opacity-100"
      )}
    >
      <TooltipProvider delayDuration={150}>
        <div className="flex items-center gap-0.5">
          {hasCopy && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCopy}
                  className={compactActionClass}
                  aria-label={isCopied ? t("copied") : t("copyMessage")}
                >
                  {isCopied ? (
                    <CheckIcon aria-hidden="true" className="h-3.5 w-3.5" />
                  ) : (
                    <CopyIcon aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {isCopied ? t("copied") : t("copyMessage")}
              </TooltipContent>
            </Tooltip>
          )}
          {translation.visible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={translation.toggle}
                  className={cn(
                    compactActionClass,
                    translation.translated && "text-foreground"
                  )}
                  aria-label={
                    translation.translated
                      ? t("showOriginal")
                      : t("translateReply")
                  }
                  aria-pressed={translation.translated}
                >
                  {translation.pending ? (
                    <Loader2
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin"
                    />
                  ) : (
                    <Languages aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {translation.translated
                  ? t("showOriginal")
                  : t("translateReply")}
              </TooltipContent>
            </Tooltip>
          )}
          {onForkFromHere && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={forkDisabled ? undefined : onForkFromHere}
                  aria-disabled={forkDisabled || undefined}
                  className={cn(
                    compactActionClass,
                    forkDisabled &&
                      "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground"
                  )}
                  aria-label={t("forkFromHere")}
                >
                  <Split aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {forkDisabled
                  ? forkDisabledReason === "unnamed"
                    ? t("forkNotReady")
                    : t("forkBusy")
                  : t("forkFromHere")}
              </TooltipContent>
            </Tooltip>
          )}
          {hasCopy && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCreateTask}
                  className={compactActionClass}
                  aria-label={tTasks("createFromMessage")}
                >
                  <ListTodo aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {tTasks("createFromMessage")}
              </TooltipContent>
            </Tooltip>
          )}
          {hasJump && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleJump}
                  className={compactActionClass}
                  aria-label={t("jumpToPreviousUserMessage")}
                >
                  <ArrowUpToLine aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t("jumpToPreviousUserMessage")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {(displayModels.length > 0 || hasTokenCounts || hasCompletedAt) && (
          <div className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-muted-foreground/80">
            {displayModels.length > 0 && (
              <span
                className="max-w-[14rem] truncate"
                title={displayModels.join(", ")}
                translate="no"
              >
                {displayModels.join(", ")}
              </span>
            )}
            {hasTokenCounts && usage && (
              <>
                {displayModels.length > 0 && <span aria-hidden="true">·</span>}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="cursor-default rounded px-1 py-0.5 font-mono tabular-nums transition-colors hover:bg-muted/60 hover:text-foreground"
                      aria-label={t("tokenStats")}
                    >
                      {formatTokenCount(totalTokens)} tokens
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between gap-3">
                        <span>{t("tokenInput")}</span>
                        <span className="font-mono tabular-nums">
                          {formatTokenCount(usage.input_tokens)}
                        </span>
                      </div>
                      {usage.output_tokens > 0 && (
                        <div className="flex justify-between gap-3">
                          <span>{t("tokenOutput")}</span>
                          <span className="font-mono tabular-nums">
                            {formatTokenCount(usage.output_tokens)}
                          </span>
                        </div>
                      )}
                      {usage.cache_read_input_tokens > 0 && (
                        <div className="flex justify-between gap-3">
                          <span>{t("tokenCacheRead")}</span>
                          <span className="font-mono tabular-nums">
                            {formatTokenCount(usage.cache_read_input_tokens)}
                          </span>
                        </div>
                      )}
                      {usage.cache_creation_input_tokens > 0 && (
                        <div className="flex justify-between gap-3">
                          <span>{t("tokenCacheWrite")}</span>
                          <span className="font-mono tabular-nums">
                            {formatTokenCount(
                              usage.cache_creation_input_tokens
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            {hasCompletedAt && completedTooltip && (
              <>
                {(displayModels.length > 0 || hasTokenCounts) && (
                  <span aria-hidden="true">·</span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="cursor-default tabular-nums"
                      aria-label={`${t("completedAt")}: ${completedTooltip}`}
                    >
                      {completedLabel}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-muted-foreground">
                        {t("completedAt")}
                      </span>
                      <span className="font-mono tabular-nums">
                        {completedTooltip}
                      </span>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        )}
      </TooltipProvider>
    </div>
  )
})
