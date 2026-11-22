"use client"

/**
 * keh4l build: the server-side follow-up queue on screen (T3 Code's layout).
 *
 * - {@link QueuedFollowUps}: dashed "not sent yet" bubbles at the end of the
 *   thread, each with send now / edit / remove, dragged to reorder. Phones
 *   keep the compact list above the composer instead.
 * - {@link PendingSteers}: a steer still cutting the running turn off
 *   (restart) — on screen at once, marked "waiting to be read".
 * - {@link HeldQueueBar}: "queue paused · N waiting · Continue" above the
 *   composer after a stop or an error.
 */

import { useCallback, useRef, useState, type PointerEvent } from "react"
import { Reorder, useDragControls } from "motion/react"
import {
  Clock,
  Forward,
  GripVertical,
  ImageIcon,
  Pause,
  Pencil,
  Trash2,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import type { QueuedMessage } from "@/hooks/use-message-queue"
import type { FollowUpSteerRecord } from "@/lib/follow-up/api"
import { cn } from "@/lib/utils"

const COLLAPSED_COUNT = 3

function imageCount(item: QueuedMessage): number {
  return item.draft.blocks.filter((b) => b.type === "image").length
}

interface BubbleProps {
  item: QueuedMessage
  index: number
  held: boolean
  running: boolean
  isEditing: boolean
  busy: boolean
  onSendNow: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

function QueuedBubble({
  item,
  index,
  held,
  running,
  isEditing,
  busy,
  onSendNow,
  onEdit,
  onDelete,
}: BubbleProps) {
  const t = useTranslations("FollowUp")
  const dragControls = useDragControls()
  const startDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      dragControls.start(event)
    },
    [dragControls]
  )
  const images = imageCount(item)
  const pending = item.id.startsWith("pending-")
  return (
    <Reorder.Item
      as="div"
      value={item}
      dragListener={false}
      dragControls={dragControls}
      className="flex flex-col items-end gap-1"
      data-follow-up-item={item.id}
    >
      <div
        className={cn(
          "flex max-w-[85%] items-start gap-2 rounded-2xl border-[1.5px] border-dashed border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground/80",
          isEditing && "border-primary/60 bg-primary/5"
        )}
      >
        <button
          type="button"
          className="mt-1 shrink-0 cursor-grab touch-none text-muted-foreground/60 active:cursor-grabbing"
          onPointerDown={startDrag}
          aria-label={t("dragToReorder")}
          title={t("dragToReorder")}
        >
          <GripVertical className="size-3.5" />
        </button>
        <span className="min-w-0 whitespace-pre-wrap break-words">
          {item.draft.displayText}
          {images > 0 ? (
            <span className="ms-1.5 inline-flex items-center gap-0.5 align-middle text-xs text-muted-foreground">
              <ImageIcon className="size-3" />
              {images}
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="me-1">
          {held
            ? t("queuedHeldLabel", { position: index + 1 })
            : t("queuedLabel", { position: index + 1 })}
        </span>
        {isEditing ? (
          <span className="text-primary">{t("editingInComposer")}</span>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              disabled={busy || pending}
              onClick={() => onSendNow(item.id)}
              title={running ? t("sendNowIntoTurn") : t("sendNowAsTurn")}
            >
              <Forward className="size-3" />
              {t("sendNow")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-xs"
              disabled={pending}
              onClick={() => onEdit(item.id)}
            >
              <Pencil className="size-3" />
              {t("edit")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-xs"
              disabled={pending}
              onClick={() => onDelete(item.id)}
            >
              <Trash2 className="size-3" />
              {t("remove")}
            </Button>
          </>
        )}
      </div>
    </Reorder.Item>
  )
}

export interface QueuedFollowUpsProps {
  queue: QueuedMessage[]
  held: boolean
  /** A turn is running: "send now" steers into it. */
  running: boolean
  editingItemId: string | null
  onReorder: (items: QueuedMessage[]) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onSendNow: (id: string) => Promise<void> | void
}

export function QueuedFollowUps({
  queue,
  held,
  running,
  editingItemId,
  onReorder,
  onEdit,
  onDelete,
  onSendNow,
}: QueuedFollowUpsProps) {
  const t = useTranslations("FollowUp")
  const [expanded, setExpanded] = useState(false)
  // One "send now" at a time: two would race for the same turn.
  const [busyId, setBusyId] = useState<string | null>(null)
  const busyRef = useRef<string | null>(null)
  const sendNow = useCallback(
    async (id: string) => {
      if (busyRef.current) return
      busyRef.current = id
      setBusyId(id)
      try {
        await onSendNow(id)
      } finally {
        busyRef.current = null
        setBusyId(null)
      }
    },
    [onSendNow]
  )

  if (queue.length === 0) return null
  const hidden = expanded ? 0 : Math.max(0, queue.length - COLLAPSED_COUNT)
  const shown = hidden > 0 ? queue.slice(0, COLLAPSED_COUNT) : queue
  const reorderVisible = (items: QueuedMessage[]) =>
    onReorder(hidden > 0 ? [...items, ...queue.slice(COLLAPSED_COUNT)] : items)

  return (
    <div
      className="flex flex-col gap-2 pt-4 pb-2"
      aria-label={t("queueAria", { count: queue.length })}
    >
      <Reorder.Group
        as="div"
        axis="y"
        values={shown}
        onReorder={reorderVisible}
        className="flex flex-col gap-2"
      >
        {shown.map((item, index) => (
          <QueuedBubble
            key={item.id}
            item={item}
            index={index}
            held={held}
            running={running}
            isEditing={editingItemId === item.id}
            busy={busyId !== null}
            onSendNow={(id) => void sendNow(id)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </Reorder.Group>
      {queue.length > COLLAPSED_COUNT ? (
        <button
          type="button"
          className="self-end text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("showFewer") : t("showMore", { count: hidden })}
        </button>
      ) : null}
    </div>
  )
}

/** Steers on their way into the turn (a restart still cutting it off). */
export function PendingSteers({ steers }: { steers: FollowUpSteerRecord[] }) {
  const t = useTranslations("FollowUp")
  if (steers.length === 0) return null
  return (
    <div className="flex flex-col items-end gap-2 pt-4">
      {steers.map((steer) => (
        <div
          key={steer.id}
          className="flex max-w-[85%] flex-col items-end gap-1"
        >
          <div className="whitespace-pre-wrap break-words rounded-2xl bg-muted px-3 py-2 text-sm leading-relaxed">
            {steer.text}
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[0.6875rem] leading-none text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
            <Clock className="size-3" />
            {t("steerPending")}
          </span>
        </div>
      ))}
    </div>
  )
}

export function HeldQueueBar({
  count,
  onResume,
}: {
  count: number
  onResume: () => void
}) {
  const t = useTranslations("FollowUp")
  return (
    <div
      className="mb-1.5 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
      data-follow-up-held-bar=""
    >
      <Pause className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{t("heldBar", { count })}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={onResume}
      >
        {t("resume")}
      </Button>
    </div>
  )
}
