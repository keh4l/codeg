"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useAcpActions } from "@/contexts/acp-connections-context"
import { useTaskContext } from "@/contexts/task-context"
import { useConnection, type UseConnectionReturn } from "@/hooks/use-connection"
import { extractAppCommandError } from "@/lib/app-error"
import { notify } from "@/lib/notify"
import { TurnBusyError } from "@/lib/turn-busy"
import { ConversationMovedError } from "@/lib/conversation-moved"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { type AgentType, type PromptDraft } from "@/lib/types"
import { getAgentLabel } from "@/lib/custom-agents"

interface UseConnectionLifecycleOptions {
  contextKey: string
  agentType: AgentType
  isActive: boolean
  workingDir?: string
  sessionId?: string
  /**
   * Persisted conversation id (when known). Passed to `connect()` so it can
   * discover and attach to a live connection another client already owns
   * (cross-client viewing) instead of always spawning a fresh agent.
   */
  conversationId?: number
  /**
   * True while the CALLER is deliberately holding auto-connect back until it
   * has resolved something the connection needs — today a historical
   * conversation's `external_id`, which must be known before connecting or the
   * backend falls back to `session/new` and orphans the history.
   *
   * It exists because `isActive` cannot say this: callers pass
   * `isActive && canConnectYet`, which collapses "this tab is in the
   * background" (nothing should happen) with "this tab is opening and is
   * waiting on its own fetch" (something IS happening, it just has nothing to
   * show yet). Without the distinction that wait — the first, silent leg of
   * opening an old conversation — produced no loading state and no status-bar
   * task, so the window read as a dead composer.
   *
   * Callers should AND it with their own active flag: a background tab must not
   * put a row in the (global) status bar.
   */
  preparing?: boolean
  /**
   * Read at unmount-cleanup time: true when the component is unmounting
   * because the view is being REPARENTED (its tab moved between split groups /
   * an unsplit merged it), not closed. A transient unmount must not
   * disconnect — the remounted instance re-attaches to the same live
   * connection under the same contextKey.
   */
  isTransientUnmount?: () => boolean
  /**
   * The runtime session (conversation-runtime store key) this view draws
   * (fork). When the view goes away its connection is parked with this, so
   * live text keeps reaching that session while nothing shows it.
   */
  runtimeConversationId?: number
}

export interface UseConnectionLifecycleReturn {
  conn: UseConnectionReturn
  modeLoading: boolean
  configOptionsLoading: boolean
  selectorsLoading: boolean
  autoConnectError: string | null
  handleFocus: () => void
  handleSend: (
    draft: PromptDraft,
    modeId?: string | null,
    opts?: {
      folderId?: number | null
      conversationId?: number | null
      clientMessageId?: string | null
      /**
       * Called when the backend rejected the send because a turn was already
       * in flight (a second, concurrent prompt). The caller re-queues the
       * draft instead of treating it as an error.
       */
      onTurnInProgress?: () => void
      /**
       * Called for every OTHER send failure (413, hydration failure, network
       * drop) after the error toast is shown. The caller must settle any
       * optimistic state it created for this send — roll back the optimistic
       * user turn so the conversation doesn't stay `awaiting_persist` (which
       * would block queue auto-flush) and doesn't display the failed prompt
       * as though it were sent. The draft is deliberately NOT re-queued: a
       * deterministic failure would otherwise retry forever.
       */
      onSendFailed?: (error: unknown) => void
    }
  ) => void
  handleSetConfigOption: (configId: string, valueId: string) => void
  /** keh4l build: resolves `false` when the stop could not be sent. */
  handleCancel: () => Promise<boolean>
  handleRespondPermission: (requestId: string, optionId: string) => void
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isExpectedConnectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  return (error as { alerted?: unknown }).alerted === true
}

export function useConnectionLifecycle({
  contextKey,
  agentType,
  isActive,
  workingDir,
  sessionId,
  conversationId,
  preparing = false,
  isTransientUnmount,
  runtimeConversationId,
}: UseConnectionLifecycleOptions): UseConnectionLifecycleReturn {
  const t = useTranslations("Folder.chat.connectionLifecycle")
  const { setActiveKey, releaseActiveKey, touchActivity, parkConnection } =
    useAcpActions()
  const { addTask, updateTask, removeTask } = useTaskContext()
  const conn = useConnection(contextKey)

  // Destructure stable callbacks (depend only on actions + contextKey)
  // vs. volatile derived state (status, modes, etc.)
  const {
    status,
    selectorsReady,
    connect: connConnect,
    sendPrompt,
    setMode: connSetMode,
    setConfigOption: connSetConfigOption,
    cancel: connCancel,
    respondPermission: connRespondPermission,
    modes,
    configOptions,
    hasCachedSelectors,
  } = conn
  const isInteractiveStatus = status === "connected" || status === "prompting"
  const hasSelectorsData = modes !== null || configOptions !== null
  const effectiveSelectorsReady = selectorsReady || hasSelectorsData
  const selectorTaskIdRef = useRef<string | null>(null)
  // Visual-only loading indicators for selector chips.
  // Skip loading indicators when we have cached selectors — even if the
  // cache contains no modes/configOptions (the agent simply doesn't have
  // them), we already know what to show and don't need a loading state.
  // `preparing` is the leg BEFORE `connecting`, when the caller is still
  // resolving what to connect to; the selectors are just as unknown there, and
  // leaving it out is what made an opening conversation show a bare composer.
  const selectorsPending =
    preparing ||
    status === "connecting" ||
    (isInteractiveStatus && !effectiveSelectorsReady)
  const modeLoading = !hasCachedSelectors && selectorsPending
  const configOptionsLoading = !hasCachedSelectors && selectorsPending
  // Gate for send button: block until the backend session is fully
  // initialized (selectorsReady from the real backend event, not cache).
  const selectorsLoading = isInteractiveStatus && !selectorsReady
  const [lastAutoConnectError, setLastAutoConnectError] = useState<{
    contextKey: string
    agentType: AgentType
    message: string
  } | null>(null)

  // Refs for auto-connect effect, which intentionally avoids volatile
  // dependencies to prevent reconnect loops. Synced via useEffect —
  // effects run in declaration order, so these are current before
  // the auto-connect effect reads them.
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  }, [status])
  const contextKeyRef = useRef(contextKey)
  useEffect(() => {
    contextKeyRef.current = contextKey
  }, [contextKey])
  const connConnectRef = useRef(connConnect)
  useEffect(() => {
    connConnectRef.current = connConnect
  }, [connConnect])
  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])
  const conversationIdRef = useRef(conversationId)
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])
  const modeIdRef = useRef<string | null>(modes?.current_mode_id ?? null)
  useEffect(() => {
    modeIdRef.current = modes?.current_mode_id ?? null
  }, [modes?.current_mode_id])
  // Sync activeKey when this view is the active tab
  useEffect(() => {
    if (isActive && contextKey) {
      setActiveKey(contextKey)
      touchActivity(contextKey)
    }
  }, [isActive, contextKey, setActiveKey, touchActivity])

  // Auto-connect when tab becomes active and workingDir is available.
  // Depends on isActive + workingDir + agentType so that connections wait
  // for folder info to load (workingDir transitions from undefined →
  // folder.path), and so that changing folders or agents on an already-
  // connected tab triggers a reconnect. The context's connect() dedups
  // same-param calls and disconnects+reconnects when workingDir or
  // agentType differs. Status changes must NOT re-trigger this to avoid
  // infinite reconnect loops on transient errors.
  useEffect(() => {
    if (!isActive) return
    if (!workingDir) return
    let cancelled = false
    connConnectRef
      .current(
        agentType,
        workingDir,
        sessionIdRef.current,
        conversationIdRef.current
      )
      .then(() => {
        if (!cancelled) {
          setLastAutoConnectError(null)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLastAutoConnectError({
            contextKey: contextKeyRef.current,
            agentType,
            message: normalizeErrorMessage(e),
          })
        }
        if (!isExpectedConnectError(e)) {
          console.error("[ConnLifecycle] auto-connect:", e)
        }
      })
    return () => {
      cancelled = true
    }
  }, [isActive, workingDir, agentType])

  // Auto-reconnect on foreground wake when the active tab's connection was
  // reaped while the browser tab was backgrounded / device was locked.
  // Two paths are covered without risking a reconnect loop:
  //   1. Already `disconnected` at wake time → reconnect immediately once.
  //   2. Still reading `connected` / `prompting` at wake time, then settled to
  //      `disconnected` by the immediate keepalive liveness probe within
  //      WAKE_RECOVERY_WINDOW_MS → reconnect once (consumes the wake timestamp
  //      so a subsequent disconnect or failure never loops).
  // `error` is intentionally excluded so permanent errors (uninstalled CLI,
  // broken config) never auto-retry in a loop.
  const WAKE_RECOVERY_WINDOW_MS = 15_000
  const lastWakeAtRef = useRef(0)
  const triggerWakeReconnect = useCallback(() => {
    if (!isActive || !workingDir) return
    lastWakeAtRef.current = 0
    setLastAutoConnectError(null)
    connConnectRef
      .current(
        agentType,
        workingDir,
        sessionIdRef.current,
        conversationIdRef.current
      )
      .catch((e: unknown) => {
        if (!isExpectedConnectError(e)) {
          console.error("[ConnLifecycle] wake reconnect:", e)
        }
      })
  }, [isActive, workingDir, agentType])

  useEffect(() => {
    if (!isActive || !workingDir) return
    const onWake = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return
      }
      touchActivity(contextKeyRef.current)
      if (statusRef.current === "disconnected") {
        triggerWakeReconnect()
      } else {
        lastWakeAtRef.current = Date.now()
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") onWake()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("pageshow", onWake)
    window.addEventListener("online", onWake)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("pageshow", onWake)
      window.removeEventListener("online", onWake)
    }
  }, [isActive, workingDir, touchActivity, triggerWakeReconnect])

  const prevWakeStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevWakeStatusRef.current
    prevWakeStatusRef.current = status
    if (
      status !== "disconnected" ||
      (prev !== "connected" && prev !== "prompting")
    ) {
      return
    }
    if (!isActive || !workingDir) return
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return
    }
    if (
      lastWakeAtRef.current > 0 &&
      Date.now() - lastWakeAtRef.current <= WAKE_RECOVERY_WINDOW_MS
    ) {
      triggerWakeReconnect()
    }
  }, [status, isActive, workingDir, triggerWakeReconnect])

  // Status-bar task for the two legs that precede a usable session:
  //   "preparing"  — the caller is resolving what to connect to (see `preparing`)
  //   "connecting" — `connect()` is in flight: agent spawn, ACP `initialize`,
  //                  then `session/resume|load|new`
  // (The third leg, session init after `connected`, has its own task below.)
  // A task's label is fixed when it is added, so a change to what it names
  // retires the old row and mints a new one rather than leaving stale wording
  // on screen. That is the leg, and also the agent: a draft can switch agents
  // while it connects, and the status reads `connecting` straight through it.
  // The agent named is the one actually coming up — the entry's own while one
  // is there (the switch has yet to tear it down, or a failed preflight left
  // it running), else the one asked for.
  const connAgentType = conn.agentType
  const taskIdRef = useRef<string | null>(null)
  const taskLabelKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const phase =
      status === "connecting" ? "connecting" : preparing ? "preparing" : null
    const taskAgentType = connAgentType ?? agentType
    const labelKey = phase === null ? null : `${phase}:${taskAgentType}`
    if (labelKey !== null && labelKey === taskLabelKeyRef.current) return
    taskLabelKeyRef.current = labelKey
    if (taskIdRef.current) {
      const finished = taskIdRef.current
      taskIdRef.current = null
      if (
        phase === null &&
        (status === "connected" || status === "prompting")
      ) {
        updateTask(finished, { status: "completed" })
      } else if (phase === null && status === "error") {
        updateTask(finished, {
          status: "failed",
          error: t("errors.connectionFailed"),
        })
      } else {
        removeTask(finished)
      }
    }
    if (phase === null) return
    // The agent is in the id too: a switch can retire a row and mint its
    // replacement within the same millisecond.
    const id = `acp-${phase}-${taskAgentType}-${Date.now()}`
    taskIdRef.current = id
    const agent = getAgentLabel(taskAgentType)
    addTask(
      id,
      phase === "connecting"
        ? t("tasks.connectingTitle", { agent })
        : t("tasks.preparingTitle", { agent }),
      phase === "connecting"
        ? t("tasks.connectingDescription")
        : t("tasks.preparingDescription")
    )
    updateTask(id, { status: "running" })
  }, [
    status,
    preparing,
    addTask,
    updateTask,
    removeTask,
    agentType,
    connAgentType,
    t,
  ])

  const clearSelectorTask = useCallback(() => {
    if (selectorTaskIdRef.current) {
      removeTask(selectorTaskIdRef.current)
      selectorTaskIdRef.current = null
    }
  }, [removeTask])

  useEffect(() => {
    const isInteractive = status === "connected" || status === "prompting"
    if (!isInteractive) {
      clearSelectorTask()
      return
    }

    if (selectorsReady) {
      clearSelectorTask()
      return
    }

    if (!selectorTaskIdRef.current) {
      const id = `acp-session-init-${Date.now()}`
      selectorTaskIdRef.current = id
      const agent = getAgentLabel(agentType)
      addTask(
        id,
        t("tasks.initSessionTitle", { agent }),
        t("tasks.initSessionDescription")
      )
      updateTask(id, { status: "running" })
    }
  }, [
    status,
    selectorsReady,
    agentType,
    addTask,
    updateTask,
    clearSelectorTask,
    t,
  ])

  const parkConnectionRef = useRef(parkConnection)
  useEffect(() => {
    parkConnectionRef.current = parkConnection
  }, [parkConnection])
  const runtimeConversationIdRef = useRef(runtimeConversationId)
  useEffect(() => {
    runtimeConversationIdRef.current = runtimeConversationId
  }, [runtimeConversationId])
  const releaseActiveKeyRef = useRef(releaseActiveKey)
  useEffect(() => {
    releaseActiveKeyRef.current = releaseActiveKey
  }, [releaseActiveKey])
  const isTransientUnmountRef = useRef(isTransientUnmount)
  useEffect(() => {
    isTransientUnmountRef.current = isTransientUnmount
  }, [isTransientUnmount])

  // Clean up on unmount (the tab closed, or a preview tab was replaced).
  // Fork: the connection is PARKED, not disconnected — kept, attach, agent
  // and all, so opening the conversation again is instant, and fed into the
  // view's runtime session meanwhile. The parked budget releases it later
  // (`parkConnection`): oldest beyond the budget, viewers after a while,
  // owners through the idle sweep — always sparing an owner with work in
  // flight (a prompting turn, background tasks, Remote Control, a running
  // delegation), whose disconnect would kill that work.
  useEffect(() => {
    return () => {
      const transientUnmount = isTransientUnmountRef.current?.() === true
      // The active key names the view on screen, and this one is gone. Left
      // claimed, it would hold the connection parked below out of both sweeps
      // for good: the keepalive touches the active key and the idle sweep
      // skips it. Not on a transient unmount — the remounted view claims the
      // same key, and a release that landed after its claim would undo it.
      // A reparented view remounts onto the same live connection at once, so
      // nothing is parked either. Released first: a parked key that is still
      // the active one counts as taken back.
      if (!transientUnmount) {
        releaseActiveKeyRef.current(contextKeyRef.current)
        parkConnectionRef.current(
          contextKeyRef.current,
          runtimeConversationIdRef.current
        )
      }
      // Task cleanup stays unconditional even on transient unmounts — the
      // remounted instance mints fresh task ids, so stale ones would orphan.
      if (taskIdRef.current) {
        removeTask(taskIdRef.current)
      }
      clearSelectorTask()
    }
  }, [removeTask, clearSelectorTask])

  const handleFocus = useCallback(() => {
    // Respect the caller's readiness gate — e.g. historical conversations
    // set isActive=false until the session's external_id resolves, to
    // avoid connecting with sessionId=undefined and orphaning context.
    if (!isActive) return
    touchActivity(contextKey)
    if (!status || status === "disconnected" || status === "error") {
      setLastAutoConnectError(null)
      connConnect(agentType, workingDir, sessionId, conversationId).catch(
        (e: unknown) => {
          if (!isExpectedConnectError(e)) {
            console.error("[ConnLifecycle] connect:", e)
          }
        }
      )
    }
  }, [
    isActive,
    agentType,
    workingDir,
    sessionId,
    conversationId,
    status,
    connConnect,
    contextKey,
    touchActivity,
  ])

  // Why connecting failed, for the composer's inline banner. The auto-connect's
  // own rejection says it first; a request parked behind another in-flight
  // connect never rejects to it (its promise resolves at once, and the run
  // that fails comes later), so fall back to what the provider published for
  // this key — the record the toast and the status chip show — as long as it
  // names the agent this surface wants. `detail ?? title` is the text that
  // request would have rejected with.
  const publishedConnectError =
    conn.connectError?.agentType === agentType ? conn.connectError : null
  const autoConnectError =
    status === "connected" || status === "prompting"
      ? null
      : lastAutoConnectError?.contextKey === contextKey &&
          lastAutoConnectError.agentType === agentType
        ? lastAutoConnectError.message
        : publishedConnectError
          ? (publishedConnectError.detail ?? publishedConnectError.title)
          : null

  // sendPrompt, connCancel, connRespondPermission are stable (depend
  // only on actions + contextKey), so these callbacks are effectively stable.
  const handleSend = useCallback(
    (
      draft: PromptDraft,
      modeId?: string | null,
      opts?: {
        folderId?: number | null
        conversationId?: number | null
        clientMessageId?: string | null
        onTurnInProgress?: () => void
        onSendFailed?: (error: unknown) => void
      }
    ) => {
      touchActivity(contextKey)
      const onTurnInProgress = opts?.onTurnInProgress
      const onSendFailed = opts?.onSendFailed
      void (async () => {
        const currentModeId = modeIdRef.current
        if (modeId && modeId !== currentModeId) {
          await connSetMode(modeId)
          // Optimistically track selected mode to avoid duplicate set_mode
          // calls before CurrentModeUpdate arrives from the agent.
          modeIdRef.current = modeId
        }
        await sendPrompt(draft.blocks, opts)
      })().catch((e: unknown) => {
        if (e instanceof TurnBusyError) {
          // A turn was already in flight on the connection (another
          // co-controlling client, or a "prompting" status this client hadn't
          // observed yet). Not an error — the draft is re-queued by the caller
          // so it auto-sends when the current turn finishes.
          onTurnInProgress?.()
          return
        }
        if (e instanceof ConversationMovedError) {
          // The conversation was moved to another project and this connection
          // still runs in the folder it left. Say where it went and pull the
          // rows: the tab follows its row to the new folder, which reconnects
          // the agent there. The message is not resent on its own — the user
          // sends it again from the new folder.
          const folder =
            e.folderId != null
              ? useAppWorkspaceStore.getState().getFolder(e.folderId)
              : undefined
          notify({
            level: "warning",
            key: `conversation-moved:${contextKey}`,
            title: t("errors.conversationMoved", {
              folder: folder?.alias || folder?.name || "",
            }),
          })
          void useAppWorkspaceStore.getState().refreshConversations()
          onSendFailed?.(e)
          return
        }
        console.error("[ConnLifecycle] sendPrompt:", e)
        // The composer already cleared itself (sends are fire-and-forget), so
        // without a toast a failed send — an oversized body 413'd by the
        // server, a hydration failure, a network drop — looks like the message
        // simply vanished. Surface the failure; prefer the structured backend
        // message over a bare stringification.
        const appError = extractAppCommandError(e)
        const message =
          appError?.message ??
          (e instanceof Error ? e.message : String(e ?? "unknown error"))
        notify({
          level: "error",
          key: `send-failed:${contextKey}`,
          title: t("errors.sendPromptFailed", { error: message }),
        })
        // Let the caller settle its optimistic state (roll back the phantom
        // user turn, drop out of awaiting_persist so the queue keeps
        // flushing). Runs after the toast so the state rollback can't hide
        // the failure.
        onSendFailed?.(e)
      })
    },
    [connSetMode, sendPrompt, contextKey, touchActivity, t]
  )

  const handleCancel = useCallback(
    () =>
      connCancel().then(
        () => true,
        (e: unknown) => {
          console.error("[ConnLifecycle] cancel:", e)
          return false
        }
      ),
    [connCancel]
  )

  const handleSetConfigOption = useCallback(
    (configId: string, valueId: string) => {
      // The connection here still belongs to another agent (a draft mid-switch,
      // or one whose new pick could not connect), so the options on screen are
      // the selected agent's cached ones. Applying the edit would hand the
      // other agent a value from a list that isn't its own, and file it under
      // that agent's saved preferences. Dropped, as an edit is when there is
      // no connection here at all.
      if (connAgentType != null && connAgentType !== agentType) return
      touchActivity(contextKey)
      connSetConfigOption(configId, valueId).catch((e: unknown) =>
        console.error("[ConnLifecycle] setConfigOption:", e)
      )
    },
    [agentType, connAgentType, connSetConfigOption, contextKey, touchActivity]
  )

  const handleRespondPermission = useCallback(
    (requestId: string, optionId: string) => {
      touchActivity(contextKey)
      connRespondPermission(requestId, optionId).catch((e: unknown) =>
        console.error("[ConnLifecycle] respondPermission:", e)
      )
    },
    [connRespondPermission, contextKey, touchActivity]
  )

  return {
    conn,
    modeLoading,
    configOptionsLoading,
    selectorsLoading,
    autoConnectError,
    handleFocus,
    handleSend,
    handleSetConfigOption,
    handleCancel,
    handleRespondPermission,
  }
}
