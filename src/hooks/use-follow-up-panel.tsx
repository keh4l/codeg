"use client"

/**
 * keh4l build: everything the conversation panel needs for steering and the
 * server-side queue, kept out of the (upstream) panel itself.
 *
 * - `handleSteer`: the composer's "steer into the running turn". The server
 *   picks the agent's native steering, else interrupt-and-restart, else the
 *   queue; a turn that already ended sends the message as a new one.
 * - `handleQueueSteer`: a queued message's "send now".
 * - The held-queue bar, the thread-tail queue (desktop) and the pending
 *   restart steers.
 * - Steer marks for the transcript, matched from the server's records.
 * - A toast when a stop beat a steer to its turn, with "put it back".
 * - A nudge to the server when the connection becomes ready with messages
 *   waiting (the server itself only sends at turn ends).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  HeldQueueBar,
  PendingSteers,
  QueuedFollowUps,
} from "@/components/chat/follow-up-queue"
import {
  buildSteerLookup,
  SteerMark,
} from "@/components/message/follow-up-marks"
import type { ResolvedMessageGroup } from "@/components/message/message-list-view"
import type { UseFollowUpQueueReturn } from "@/hooks/use-follow-up-queue"
import { useIsMobile } from "@/hooks/use-mobile"
import { toErrorMessage } from "@/lib/app-error"
import {
  FOLLOW_UP_STEER_UNDELIVERED_EVENT,
  FOLLOW_UP_STEERS_CHANGED_EVENT,
  type FollowUpSteerRecord,
  type FollowUpSteerUndelivered,
  followUpEnqueue,
  followUpKick,
  followUpSteer,
} from "@/lib/follow-up/api"
import { cachedFollowUpSteers, loadFollowUpSteers } from "@/lib/follow-up/cache"
import { setFollowUpComposerBridge } from "@/lib/follow-up/composer-bridge"
import {
  onTransportReconnect,
  subscribe as subscribePlatform,
} from "@/lib/platform"
import type { ConnectionStatus, PromptInputBlock } from "@/lib/types"

/** The composer's turn-ended fallback recognizes this message. */
const NO_ACTIVE_TURN = "no active turn"

export interface UseFollowUpPanelArgs {
  tabId: string
  queue: UseFollowUpQueueReturn
  conversationId: number | null
  connectionId: string | null
  connStatus: ConnectionStatus | null
  connectionReady: boolean
  awaitingPersist: boolean
  modeId: string | null
  onHandBack: (blocks: PromptInputBlock[]) => void
  onQueueEdit: (id: string) => void
}

export function useFollowUpPanel({
  tabId,
  queue,
  conversationId,
  connectionId,
  connStatus,
  connectionReady,
  awaitingPersist,
  modeId,
  onHandBack,
  onQueueEdit,
}: UseFollowUpPanelArgs) {
  const t = useTranslations("FollowUp")
  const isMobile = useIsMobile()
  const running = connStatus === "prompting"

  // ── Steer records (for the transcript marks and pending restarts) ──
  const [records, setRecords] = useState<{
    conversationId: number | null
    items: FollowUpSteerRecord[]
  }>({ conversationId: null, items: [] })
  useEffect(() => {
    if (conversationId == null) return
    let cancelled = false
    const load = () => {
      loadFollowUpSteers(conversationId)
        .then((items) => {
          if (!cancelled) setRecords({ conversationId, items })
        })
        .catch(() => {})
    }
    // Fork: the records kept since it was last open, if none changed since.
    const cached = cachedFollowUpSteers(conversationId)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer stands in for the read, as its result would
    if (cached) setRecords({ conversationId, items: cached })
    else load()
    const stopReconnect = onTransportReconnect(load)
    let unlisten: (() => void) | null = null
    void subscribePlatform<{ conversationId: number }>(
      FOLLOW_UP_STEERS_CHANGED_EVENT,
      (payload) => {
        if (!cancelled && payload.conversationId === conversationId) load()
      }
    )
      .then((stop) => {
        if (cancelled) stop()
        else unlisten = stop
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
      stopReconnect?.()
    }
  }, [conversationId])
  const steerRecords = useMemo(
    () => (records.conversationId === conversationId ? records.items : []),
    [records, conversationId]
  )
  const lookup = useMemo(() => buildSteerLookup(steerRecords), [steerRecords])
  const pendingSteers = useMemo(
    () => steerRecords.filter((r) => r.status === "pending"),
    [steerRecords]
  )
  const userTurnFooter = useCallback(
    (group: ResolvedMessageGroup) =>
      lookup.find(group) ? <SteerMark pending={false} /> : null,
    [lookup]
  )
  const isRestartTurn = useCallback(
    (group: ResolvedMessageGroup) => lookup.find(group)?.how === "restart",
    [lookup]
  )

  // ── Steering ──
  const handleSteer = useCallback(
    async (text: string, blocks?: PromptInputBlock[]) => {
      if (!connectionId) throw new Error(NO_ACTIVE_TURN)
      const promptBlocks: PromptInputBlock[] = blocks ?? [
        { type: "text", text },
      ]
      const result = await followUpSteer({
        connectionId,
        conversationId,
        text,
        blocks: promptBlocks,
      })
      if (result.how === "queued") {
        toast.info(t("steerQueued"))
      } else if (result.how === "not_running") {
        // The turn ended first: this is simply the next message.
        if (conversationId == null) throw new Error(NO_ACTIVE_TURN)
        await followUpEnqueue({
          conversationId,
          connectionId,
          text,
          blocks: promptBlocks,
          modeId,
          adoptSendTimeMode: false,
        })
      }
    },
    [connectionId, conversationId, modeId, t]
  )

  const { sendNow } = queue
  const handleQueueSteer = useCallback(
    async (id: string) => {
      const result = await sendNow(id)
      if (result?.how === "queued" && running) toast.info(t("steerQueued"))
    },
    [sendNow, running, t]
  )

  // ── The composer's queue shortcuts ──
  const oldestId = queue.queue[0]?.id ?? null
  const latestId = queue.queue[queue.queue.length - 1]?.id ?? null
  useEffect(() => {
    setFollowUpComposerBridge(tabId, {
      steerOldest:
        running && oldestId && queue.serverMode
          ? () => void handleQueueSteer(oldestId)
          : undefined,
      editLatest: latestId ? () => onQueueEdit(latestId) : undefined,
      resumeHeld: queue.held ? queue.resume : undefined,
    })
  }, [
    tabId,
    running,
    oldestId,
    latestId,
    queue.serverMode,
    queue.held,
    queue.resume,
    handleQueueSteer,
    onQueueEdit,
  ])
  useEffect(() => () => setFollowUpComposerBridge(tabId, null), [tabId])

  // ── Stop beat a steer to its turn ──
  useEffect(() => {
    if (!connectionId) return
    let cancelled = false
    let unlisten: (() => void) | null = null
    void subscribePlatform<FollowUpSteerUndelivered>(
      FOLLOW_UP_STEER_UNDELIVERED_EVENT,
      (payload) => {
        if (cancelled || payload.connectionId !== connectionId) return
        toast(t("steerUndelivered", { text: payload.text }), {
          duration: 12_000,
          action: {
            label: t("putBack"),
            onClick: () => onHandBack(payload.blocks),
          },
        })
      }
    )
      .then((stop) => {
        if (cancelled) stop()
        else unlisten = stop
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [connectionId, onHandBack, t])

  // ── Messages waiting when the connection becomes ready ──
  const waiting = queue.serverMode ? queue.queue.length : 0
  useEffect(() => {
    if (
      conversationId == null ||
      !connectionId ||
      !connectionReady ||
      connStatus !== "connected" ||
      awaitingPersist ||
      queue.held ||
      waiting === 0
    )
      return
    const timer = setTimeout(() => {
      followUpKick(conversationId, connectionId).catch((err) =>
        toast.error(t("sendFailed"), { description: toErrorMessage(err) })
      )
    }, 400)
    return () => clearTimeout(timer)
  }, [
    conversationId,
    connectionId,
    connectionReady,
    connStatus,
    awaitingPersist,
    queue.held,
    waiting,
    t,
  ])

  // ── On screen ──
  const heldBar = queue.held ? (
    <HeldQueueBar count={queue.queue.length} onResume={queue.resume} />
  ) : null
  const inThread = queue.serverMode && !isMobile
  const threadTail =
    inThread && (queue.queue.length > 0 || pendingSteers.length > 0) ? (
      <>
        <PendingSteers steers={pendingSteers} />
        <QueuedFollowUps
          queue={queue.queue}
          held={queue.held}
          running={running}
          editingItemId={queue.editingItemId}
          onReorder={queue.reorder}
          onEdit={onQueueEdit}
          onDelete={queue.remove}
          onSendNow={handleQueueSteer}
        />
      </>
    ) : !inThread && pendingSteers.length > 0 ? (
      <PendingSteers steers={pendingSteers} />
    ) : null

  return {
    handleSteer,
    handleQueueSteer,
    heldBar,
    threadTail,
    /** The compact list above the composer: phones, and the local queue. */
    queueAboveComposer: !inThread,
    userTurnFooter,
    isRestartTurn,
  }
}
