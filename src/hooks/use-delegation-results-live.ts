"use client"

/**
 * keh4l build: follow `delegation_results_delivered` / `delegation_push_held`
 * on one parent connection (see `@/lib/delegation-results-live`).
 *
 * A wake puts a `system` turn holding the results in the transcript right
 * away, through the same path a cross-client viewer's synthesized user turn
 * takes, so the reply that follows has its cause above it; the reload that
 * follows the turn replaces it with the parsed one. Results that rode along
 * with a message are remembered by that message's id for its bubble. A steer
 * shows once the turn it went into is reloaded: inserting it live would put
 * it above the reply it interrupted.
 */

import { useCallback } from "react"

import { useAcpEvent } from "@/contexts/acp-connections-context"
import {
  recordAttachedResults,
  setDelegationPushHeld,
} from "@/lib/delegation-results-live"
import { useConversationRuntimeStore } from "@/stores/conversation-runtime-store"
import type { EventEnvelope, MessageTurn } from "@/lib/types"

/** The id the live `system` turn of a wake goes by. */
export function delegationResultsTurnId(resultsId: string): string {
  return `delegation-results-${resultsId}`
}

function holdsResults(turns: readonly MessageTurn[] | undefined, id: string) {
  return (
    turns?.some((turn) =>
      turn.blocks.some(
        (block) => block.type === "delegation_results" && block.id === id
      )
    ) ?? false
  )
}

export function useDelegationResultsLive(
  connectionId: string | null,
  conversationId: number,
  appendTurn: (conversationId: number, turn: MessageTurn) => void
): void {
  useAcpEvent(
    useCallback(
      (envelope: EventEnvelope) => {
        if (!connectionId || envelope.connection_id !== connectionId) return
        if (envelope.type === "delegation_push_held") {
          setDelegationPushHeld(connectionId, envelope.held)
          return
        }
        if (envelope.type !== "delegation_results_delivered") return
        const results = {
          id: envelope.id,
          mode: envelope.mode,
          tasks: envelope.tasks,
        }
        if (envelope.mode === "attached") {
          if (envelope.message_id) {
            recordAttachedResults(envelope.message_id, results)
          }
          return
        }
        if (envelope.mode !== "wake") return
        const session = useConversationRuntimeStore
          .getState()
          .byConversationId.get(conversationId)
        if (
          session &&
          (holdsResults(session.detail?.turns, envelope.id) ||
            holdsResults(session.localTurns, envelope.id) ||
            holdsResults(session.optimisticTurns, envelope.id))
        ) {
          return
        }
        appendTurn(conversationId, {
          id: delegationResultsTurnId(envelope.id),
          role: "system",
          blocks: [{ type: "delegation_results", ...results }],
          timestamp: new Date().toISOString(),
        })
      },
      [connectionId, conversationId, appendTurn]
    )
  )
}
