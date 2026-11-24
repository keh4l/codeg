"use client"

/**
 * keh4l build: the message queue, kept on the server once the conversation
 * exists (`@/lib/follow-up/api`), with the same surface as
 * {@link useMessageQueue} so the panel's call sites stay as they are.
 *
 * - **Server mode** (`conversationId` known): the list comes from the server
 *   and follows its broadcasts, so every window and device shows one queue and
 *   a reload keeps it. The server sends it, one message per turn that ends
 *   normally; `dequeue` is therefore always empty here.
 * - **Local mode** (a brand-new conversation still connecting): there is no
 *   conversation to store against yet, so the browser keeps the queue as
 *   before. Whatever is left in it when the conversation appears moves to the
 *   server.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  type QueuedMessage,
  type UseMessageQueueReturn,
  useMessageQueue,
} from "@/hooks/use-message-queue"
import { toErrorMessage } from "@/lib/app-error"
import {
  FOLLOW_UP_QUEUE_CHANGED_EVENT,
  type FollowUpQueueItem,
  type FollowUpQueueView,
  type FollowUpSteerResult,
  followUpEnqueue,
  followUpRemove,
  followUpReorder,
  followUpResume,
  followUpSendNow,
  followUpUpdate,
} from "@/lib/follow-up/api"
import { cachedFollowUpQueue, loadFollowUpQueue } from "@/lib/follow-up/cache"
import {
  onTransportReconnect,
  subscribe as subscribePlatform,
} from "@/lib/platform"
import type { PromptDraft } from "@/lib/types"
import { randomUUID } from "@/lib/utils"

export interface UseFollowUpQueueReturn extends UseMessageQueueReturn {
  /** The queue lives on the server (the conversation exists). */
  serverMode: boolean
  /** Stopped or errored: nothing goes out until {@link resume}. */
  held: boolean
  resume: () => void
  /** "Send now": into the running turn, else as a new turn. */
  sendNow: (id: string) => Promise<FollowUpSteerResult | null>
}

export function toQueuedMessage(item: FollowUpQueueItem): QueuedMessage {
  return {
    id: item.id,
    draft: { blocks: item.blocks, displayText: item.text },
    modeId: item.modeId,
    ...(item.adoptSendTimeMode ? { adoptSendTimeMode: true } : {}),
  }
}

interface ServerState {
  conversationId: number | null
  items: QueuedMessage[]
  held: boolean
}

const EMPTY: ServerState = { conversationId: null, items: [], held: false }

export function useFollowUpQueue({
  conversationId,
  connectionId,
}: {
  conversationId: number | null
  connectionId: string | null
}): UseFollowUpQueueReturn {
  const t = useTranslations("Folder.chat.messageQueue")
  const {
    queue: localQueue,
    enqueue: localEnqueue,
    requeueFront: localRequeueFront,
    dequeue: localDequeue,
    remove: localRemove,
    reorder: localReorder,
    moveToFront: localMoveToFront,
    updateItem: localUpdateItem,
    getQueueLength: localGetQueueLength,
    editingItemId: localEditingItemId,
    startEditing: localStartEditing,
    cancelEditing: localCancelEditing,
  } = useMessageQueue()
  const serverMode = conversationId != null

  const [server, setServer] = useState<ServerState>(EMPTY)
  const serverRef = useRef<ServerState>(EMPTY)
  const commit = useCallback((next: ServerState) => {
    serverRef.current = next
    setServer(next)
  }, [])
  // The server state of THIS conversation (another one's is stale).
  const current = useCallback(
    (): ServerState =>
      serverRef.current.conversationId === conversationId
        ? serverRef.current
        : { conversationId, items: [], held: false },
    [conversationId]
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const connectionRef = useRef(connectionId)
  useEffect(() => {
    connectionRef.current = connectionId
  }, [connectionId])

  const fail = useCallback(
    (err: unknown) => {
      toast.error(t("serverError"), { description: toErrorMessage(err) })
    },
    [t]
  )

  const apply = useCallback(
    (view: FollowUpQueueView) => {
      if (view.conversationId !== conversationId) return
      commit({
        conversationId: view.conversationId,
        items: view.items.map(toQueuedMessage),
        held: view.held,
      })
    },
    [commit, conversationId]
  )

  // Load, then follow the server's broadcasts.
  // (What another conversation left in `server` is never shown: the render
  // reads it only under a matching id — see `current` below.)
  useEffect(() => {
    if (conversationId == null) return
    let cancelled = false
    const load = () => {
      loadFollowUpQueue(conversationId)
        .then((view) => {
          if (!cancelled) apply(view)
        })
        .catch(() => {})
    }
    // Fork: what the broadcasts kept since it was last open, if anything.
    const cached = cachedFollowUpQueue(conversationId)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept view stands in for the read, as its result would
    if (cached) apply(cached)
    else load()
    // Broadcasts sent while a web client was offline are lost: reload.
    const stopReconnect = onTransportReconnect(load)
    let unlisten: (() => void) | null = null
    void subscribePlatform<FollowUpQueueView>(
      FOLLOW_UP_QUEUE_CHANGED_EVENT,
      (view) => {
        if (!cancelled) apply(view)
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
  }, [conversationId, apply])

  // Anything queued locally before the conversation existed moves over.
  const migratingRef = useRef(false)
  useEffect(() => {
    if (conversationId == null || localQueue.length === 0) return
    if (migratingRef.current) return
    migratingRef.current = true
    const items = [...localQueue]
    void (async () => {
      try {
        for (const item of items) {
          await followUpEnqueue({
            conversationId,
            connectionId: connectionRef.current,
            text: item.draft.displayText,
            blocks: item.draft.blocks,
            modeId: item.modeId,
            adoptSendTimeMode: item.adoptSendTimeMode === true,
          })
          localRemove(item.id)
        }
      } catch (err) {
        fail(err)
      } finally {
        migratingRef.current = false
      }
    })()
  }, [conversationId, localQueue, localRemove, fail])

  // keh4l build: a queued message carries the id it will have on the server
  // (`clientId`), so it can be removed, edited, reordered or sent before the
  // broadcast that confirms it; each of those waits for its enqueue to land
  // first, and is dropped if the enqueue failed (the item is gone then).
  const pendingEnqueuesRef = useRef(new Map<string, Promise<boolean>>())
  const afterEnqueued = useCallback(
    (ids: string[]) =>
      Promise.all(
        ids.map((id) => pendingEnqueuesRef.current.get(id) ?? true)
      ).then((landed) => landed.every(Boolean)),
    []
  )

  const enqueue = useCallback<UseMessageQueueReturn["enqueue"]>(
    (draft, modeId, opts) => {
      if (conversationId == null) {
        localEnqueue(draft, modeId, opts)
        return
      }
      const id = randomUUID()
      commit({
        ...current(),
        held: false,
        items: [...current().items, { id, draft, modeId }],
      })
      const landed = followUpEnqueue({
        conversationId,
        connectionId: connectionRef.current,
        text: draft.displayText,
        blocks: draft.blocks,
        modeId,
        adoptSendTimeMode: opts?.adoptSendTimeMode === true,
        clientId: id,
      }).then(
        () => true,
        (err) => {
          commit({
            ...current(),
            items: current().items.filter((i) => i.id !== id),
          })
          fail(err)
          return false
        }
      )
      pendingEnqueuesRef.current.set(id, landed)
      void landed.finally(() => pendingEnqueuesRef.current.delete(id))
    },
    [conversationId, localEnqueue, commit, fail, current]
  )

  const requeueFront = useCallback<UseMessageQueueReturn["requeueFront"]>(
    (draft, modeId) => {
      if (conversationId == null) localRequeueFront(draft, modeId)
      else enqueue(draft, modeId)
    },
    [conversationId, localRequeueFront, enqueue]
  )

  const dequeue = useCallback<UseMessageQueueReturn["dequeue"]>(
    () => (conversationId == null ? localDequeue() : undefined),
    [conversationId, localDequeue]
  )

  const remove = useCallback(
    (id: string) => {
      if (conversationId == null) {
        localRemove(id)
        return
      }
      if (editingId === id) setEditingId(null)
      commit({
        ...current(),
        items: current().items.filter((i) => i.id !== id),
      })
      afterEnqueued([id])
        .then((landed) => (landed ? followUpRemove(id) : undefined))
        .catch(fail)
    },
    [
      conversationId,
      localRemove,
      editingId,
      commit,
      fail,
      current,
      afterEnqueued,
    ]
  )

  const reorder = useCallback(
    (items: QueuedMessage[]) => {
      if (conversationId == null) {
        localReorder(items)
        return
      }
      const live = current().items
      if (items.length !== live.length) return
      const byId = new Map(live.map((i) => [i.id, i]))
      const next: QueuedMessage[] = []
      for (const item of items) {
        const found = byId.get(item.id)
        if (!found) return
        next.push(found)
      }
      commit({ ...current(), items: next })
      const ids = next.map((i) => i.id)
      afterEnqueued(ids)
        .then((landed) =>
          landed ? followUpReorder(conversationId, ids) : undefined
        )
        .catch(fail)
    },
    [conversationId, localReorder, commit, fail, current, afterEnqueued]
  )

  const moveToFront = useCallback(
    (id: string) => {
      if (conversationId == null) {
        localMoveToFront(id)
        return
      }
      const live = current().items
      const index = live.findIndex((i) => i.id === id)
      if (index <= 0) return
      reorder([live[index], ...live.filter((i) => i.id !== id)])
    },
    [conversationId, localMoveToFront, reorder, current]
  )

  const updateItem = useCallback(
    (id: string, draft: PromptDraft) => {
      if (conversationId == null) {
        localUpdateItem(id, draft)
        return
      }
      commit({
        ...current(),
        items: current().items.map((i) => (i.id === id ? { ...i, draft } : i)),
      })
      setEditingId(null)
      afterEnqueued([id])
        .then((landed) =>
          landed
            ? followUpUpdate(id, draft.displayText, draft.blocks)
            : undefined
        )
        .catch(fail)
    },
    [conversationId, localUpdateItem, commit, fail, current, afterEnqueued]
  )

  const getQueueLength = useCallback(
    () =>
      conversationId == null ? localGetQueueLength() : current().items.length,
    [conversationId, localGetQueueLength, current]
  )

  const resume = useCallback(() => {
    if (conversationId == null) return
    commit({ ...current(), held: false })
    followUpResume(conversationId, connectionRef.current).catch(fail)
  }, [conversationId, commit, fail, current])

  const sendNow = useCallback(
    async (id: string): Promise<FollowUpSteerResult | null> => {
      const connection = connectionRef.current
      if (conversationId == null || !connection) return null
      try {
        if (!(await afterEnqueued([id]))) return null
        return await followUpSendNow(id, connection)
      } catch (err) {
        fail(err)
        return null
      }
    },
    [conversationId, fail, afterEnqueued]
  )

  const startEditing = useCallback(
    (id: string) => {
      if (conversationId == null) localStartEditing(id)
      else setEditingId(id)
    },
    [conversationId, localStartEditing]
  )
  const cancelEditing = useCallback(() => {
    if (conversationId == null) localCancelEditing()
    else setEditingId(null)
  }, [conversationId, localCancelEditing])

  const serverItems =
    server.conversationId === conversationId ? server.items : EMPTY.items
  const queue = serverMode ? serverItems : localQueue
  // A queue being edited that vanished (sent, removed elsewhere) stops editing.
  const editingItemId = serverMode
    ? editingId && serverItems.some((i) => i.id === editingId)
      ? editingId
      : null
    : localEditingItemId
  const held = serverMode && server.held && serverItems.length > 0

  return useMemo(
    () => ({
      queue,
      enqueue,
      requeueFront,
      dequeue,
      remove,
      reorder,
      moveToFront,
      updateItem,
      getQueueLength,
      editingItemId,
      startEditing,
      cancelEditing,
      serverMode,
      held,
      resume,
      sendNow,
    }),
    [
      queue,
      enqueue,
      requeueFront,
      dequeue,
      remove,
      reorder,
      moveToFront,
      updateItem,
      getQueueLength,
      editingItemId,
      startEditing,
      cancelEditing,
      serverMode,
      held,
      resume,
      sendNow,
    ]
  )
}
