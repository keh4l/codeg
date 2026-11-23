"use client"

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import Image from "next/image"
import {
  CheckIcon,
  ChevronDown,
  ChevronUp,
  CopyIcon,
  Download,
  Languages,
  ListTodo,
  Pencil,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import type {
  AdaptedContentPart,
  UserImageDisplay,
  UserResourceDisplay,
} from "@/lib/adapters/ai-elements-adapter"
import { unescapeComposerText } from "@/lib/composer-copy-text"
import { cn, copyTextToClipboard } from "@/lib/utils"
import { ImagePreviewDialog } from "@/components/ui/image-preview-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ContentPartsRenderer } from "../content-parts-renderer"
import { ImageActions, useImageActions } from "../image-actions"
import { useSentOriginal } from "../translation-context"
import { useCreateTaskFromMessage } from "../use-create-task-from-message"
import { UserResourceLinks } from "../user-resource-links"
import { useCompactThread } from "./compact-thread"
import { imageSrc } from "@/lib/conversation-images"

export type UserBubbleGroupPosition = "solo" | "first" | "middle" | "last"

/** Fold threshold (rem): messages taller than 22rem collapse to 11rem (max-h-44). */
const USER_FOLD_THRESHOLD_REM = 22

function extractUserText(parts: AdaptedContentPart[]): string {
  return parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
}

function replaceTextInParts(
  parts: AdaptedContentPart[],
  text: string
): AdaptedContentPart[] {
  let placed = false
  return parts.flatMap((part): AdaptedContentPart[] => {
    if (part.type !== "text") return [part]
    if (placed) return []
    placed = true
    return [{ ...part, text }]
  })
}

function rootFontSizePx(): number {
  if (typeof window === "undefined") return 16
  const parsed = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize
  )
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16
}

/**
 * Collapses a user bubble's text ONLY when its natural height exceeds 22rem,
 * folding down to `max-h-44` (11rem) with a bottom "Expand" button (T3 rule).
 */
const CompactUserCollapsibleText = memo(function CompactUserCollapsibleText({
  parts,
}: {
  parts: AdaptedContentPart[]
}) {
  const t = useTranslations("Folder.chat.messageList")
  const contentId = useId()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [shouldFold, setShouldFold] = useState(false)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const check = () => {
      const thresholdPx = USER_FOLD_THRESHOLD_REM * rootFontSizePx()
      // Measure natural height: scrollHeight stays the full content height even
      // while clamped with overflow-hidden.
      setShouldFold(el.scrollHeight > thresholdPx + 1)
    }
    check()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [parts])

  const clipped = shouldFold && !expanded

  return (
    <>
      <div
        ref={contentRef}
        id={contentId}
        data-compact-user-text=""
        data-clipped={clipped ? "true" : undefined}
        className={cn(
          "min-w-0",
          clipped && "max-h-44 overflow-hidden collapsed-content-fade"
        )}
      >
        <ContentPartsRenderer parts={parts} role="user" />
      </div>
      {shouldFold ? (
        <button
          type="button"
          data-compact-user-fold-toggle=""
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={contentId}
          className="mt-1 flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? t("showLess") : t("showMore")}
          {expanded ? (
            <ChevronUp className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
        </button>
      ) : null}
    </>
  )
})

/** Images rendered inside the user bubble as a compact collage (1 large, 2-4
 *  grid, >4 with +N badge on the fourth tile). */
const UserMediaCollage = memo(function UserMediaCollage({
  images,
}: {
  images: UserImageDisplay[]
}) {
  const t = useTranslations("Folder.chat.messageList")
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const { canCopy, copy, download } = useImageActions()

  if (images.length === 0) return null

  const visible = images.slice(0, 4)
  const overflow = images.length - visible.length
  const previewImage =
    previewIndex !== null && previewIndex < images.length
      ? images[previewIndex]
      : null

  return (
    <div data-compact-media-collage="" className="mb-2 last:mb-0">
      <div
        className={cn(
          "grid gap-1.5",
          visible.length === 1 ? "grid-cols-1" : "grid-cols-2"
        )}
      >
        {visible.map((image, index) => {
          const isOverflowTile = index === 3 && overflow > 0
          const spanTwo = visible.length === 3 && index === 0
          return (
            <ImageActions
              key={`${image.uri ?? image.name}-${index}`}
              image={image}
              className={cn(
                "group/img relative overflow-hidden rounded-xl border border-foreground/10 bg-background/40",
                spanTwo && "col-span-2"
              )}
            >
              <button
                type="button"
                onClick={() => setPreviewIndex(index)}
                className="block w-full cursor-pointer transition-opacity hover:opacity-90"
              >
                <Image
                  src={imageSrc(image)}
                  alt={image.name}
                  width={visible.length === 1 ? 320 : 160}
                  height={visible.length === 1 ? 220 : 120}
                  unoptimized
                  className={cn(
                    "w-full object-cover",
                    visible.length === 1
                      ? "max-h-60 max-w-full"
                      : spanTwo
                        ? "h-32"
                        : "h-24"
                  )}
                />
                {isOverflowTile ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-base font-semibold text-white">
                    +{overflow}
                  </span>
                ) : null}
              </button>
              {!isOverflowTile ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void download(image)
                  }}
                  className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 text-foreground/80 opacity-0 shadow-sm transition-opacity hover:bg-background hover:text-foreground group-hover/img:opacity-100 focus-visible:opacity-100"
                  aria-label={t("downloadImage")}
                  title={t("downloadImage")}
                >
                  <Download className="h-3 w-3" />
                </button>
              ) : null}
            </ImageActions>
          )
        })}
      </div>

      <ImagePreviewDialog
        src={imageSrc(previewImage)}
        alt={previewImage?.name ?? ""}
        open={previewImage !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewIndex(null)
        }}
        onDownload={
          previewImage ? () => void download(previewImage) : undefined
        }
        downloadLabel={t("downloadImage")}
        onCopy={
          previewImage && canCopy ? () => void copy(previewImage) : undefined
        }
        copyLabel={t("copyImage")}
        renderImage={
          previewImage
            ? (image) => (
                <ImageActions image={previewImage}>{image}</ImageActions>
              )
            : undefined
        }
      />
    </div>
  )
})

const userActionBtnClass =
  "inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * keh4l build: T3-style user message bubble.
 *
 * Right-aligned (`max-w-[80%]`), `rounded-2xl`, `bg-[var(--message)]`,
 * consecutive messages grouped tightly with softened inner corners, media
 * collage inside the bubble, folds only past 22rem to `max-h-44`, and shows a
 * quiet hover footer below (timestamp, copy, edit-into-composer, create task).
 */
export const CompactUserBubble = memo(function CompactUserBubble({
  parts,
  images,
  resources,
  timestamp,
  groupPos = "solo",
  risesIn = false,
  dimmed = false,
}: {
  parts: AdaptedContentPart[]
  images: UserImageDisplay[]
  resources: UserResourceDisplay[]
  timestamp?: string | null
  groupPos?: UserBubbleGroupPosition
  risesIn?: boolean
  dimmed?: boolean
}) {
  const locale = useLocale()
  const t = useTranslations("Folder.chat.messageList")
  const tCompact = useTranslations("CompactView")
  const tTasks = useTranslations("Tasks")
  const { onEditUserMessage } = useCompactThread()
  const [isCopied, setIsCopied] = useState(false)
  const [touchRevealed, setTouchRevealed] = useState(false)
  const timeoutRef = useRef<number>(0)

  const sentText = useMemo(() => extractUserText(parts), [parts])
  const { original, showing, toggle } = useSentOriginal(sentText)
  const shownParts = useMemo(
    () =>
      showing && original !== null
        ? replaceTextInParts(parts, original)
        : parts,
    [parts, showing, original]
  )
  const plainText = useMemo(
    () =>
      showing && original !== null ? original : unescapeComposerText(sentText),
    [showing, original, sentText]
  )

  const timestampDate = useMemo(() => {
    if (!timestamp) return null
    const ms = new Date(timestamp).getTime()
    return Number.isNaN(ms) ? null : new Date(ms)
  }, [timestamp])

  const shortTime = useMemo(() => {
    if (!timestampDate) return null
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestampDate)
  }, [locale, timestampDate])

  const fullTime = useMemo(() => {
    if (!timestampDate) return null
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(timestampDate)
  }, [locale, timestampDate])

  const getTaskText = useCallback(() => plainText, [plainText])
  const createTask = useCreateTaskFromMessage(getTaskText)

  const handleCopy = useCallback(async () => {
    if (isCopied || !plainText) return
    window.clearTimeout(timeoutRef.current)
    const ok = await copyTextToClipboard(plainText)
    if (!ok) return
    setIsCopied(true)
    timeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000)
  }, [isCopied, plainText])

  const handleEdit = useCallback(() => {
    if (!onEditUserMessage || !plainText) return
    onEditUserMessage(plainText)
  }, [onEditUserMessage, plainText])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    []
  )

  const cornerClass =
    groupPos === "first"
      ? "rounded-2xl rounded-br-md"
      : groupPos === "middle"
        ? "rounded-2xl rounded-tr-md rounded-br-md"
        : groupPos === "last"
          ? "rounded-2xl rounded-tr-md"
          : "rounded-2xl"

  const hasText = shownParts.some(
    (p) => p.type !== "text" || p.text.trim().length > 0
  )

  return (
    <div
      data-compact-user-group={groupPos}
      className={cn(
        "group/compact-user flex flex-col items-end transition-opacity duration-300",
        dimmed && "opacity-70",
        risesIn && "chat-enter-rise"
      )}
    >
      <div
        data-compact-user-bubble=""
        onPointerUp={(event) => {
          if (event.pointerType === "touch") {
            setTouchRevealed((v) => !v)
          }
        }}
        className={cn(
          "is-user is-user:dark ws-msg-secondary w-fit max-w-[80%] overflow-hidden bg-[var(--message)] p-3 text-sm text-foreground",
          cornerClass
        )}
      >
        {images.length > 0 ? <UserMediaCollage images={images} /> : null}
        {hasText ? <CompactUserCollapsibleText parts={shownParts} /> : null}
      </div>

      {resources.length > 0 ? (
        <UserResourceLinks resources={resources} className="mt-1.5 self-end" />
      ) : null}

      <div
        data-compact-user-footer=""
        data-visible={showing || touchRevealed ? "true" : undefined}
        className={cn(
          "compact-user-footer mt-1 flex items-center justify-end gap-1 text-[0.6875rem] text-muted-foreground",
          (showing || touchRevealed) && "opacity-100"
        )}
      >
        <TooltipProvider delayDuration={150}>
          {shortTime && fullTime ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default px-1 tabular-nums">
                  {shortTime}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{fullTime}</TooltipContent>
            </Tooltip>
          ) : null}

          {original !== null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggle}
                  aria-pressed={showing}
                  aria-label={showing ? t("showSent") : t("showSentOriginal")}
                  className={cn(
                    userActionBtnClass,
                    showing && "text-foreground"
                  )}
                >
                  <Languages className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {showing ? t("showSent") : t("showSentOriginal")}
              </TooltipContent>
            </Tooltip>
          ) : null}

          {plainText ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label={isCopied ? t("copied") : t("copyMessage")}
                  className={userActionBtnClass}
                >
                  {isCopied ? (
                    <CheckIcon className="size-3" />
                  ) : (
                    <CopyIcon className="size-3" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isCopied ? t("copied") : t("copyMessage")}
              </TooltipContent>
            </Tooltip>
          ) : null}

          {onEditUserMessage && plainText ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-compact-user-edit=""
                  onClick={handleEdit}
                  aria-label={tCompact("editMessage")}
                  className={userActionBtnClass}
                >
                  <Pencil className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {tCompact("editMessage")}
              </TooltipContent>
            </Tooltip>
          ) : null}

          {plainText ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={createTask}
                  aria-label={tTasks("createFromMessage")}
                  className={userActionBtnClass}
                >
                  <ListTodo className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {tTasks("createFromMessage")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </TooltipProvider>
      </div>
    </div>
  )
})
