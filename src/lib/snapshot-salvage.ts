import type { ConnectionStatus } from "@/lib/types"

/**
 * The few fields of a live-session snapshot that decide whether a surface is
 * usable at all — read straight off the wire, each one checked on its own.
 *
 * For when the full read (`denormalizeSnapshot` and the hydrate behind it)
 * throws. A snapshot is the only way a surface that attached mid-turn learns
 * the connection's status: the `status_changed` that started the turn is long
 * gone. Losing the whole snapshot to one malformed block left the surface on
 * the `connecting` placeholder its entry was created with — composer locked,
 * no Stop button — for as long as the turn ran, and every reload fetched the
 * same snapshot and failed the same way. These fields are enough to put the
 * surface back in step; the rest arrives with the live events and the
 * transcript once the turn ends.
 */
export interface SnapshotSalvage {
  connectionId: string
  status: ConnectionStatus
  sessionId: string | null
  selectorsReady: boolean
  supportsFork: boolean
  eventSeq: number
}

const STATUSES: ReadonlySet<string> = new Set<ConnectionStatus>([
  "connecting",
  "connected",
  "prompting",
  "disconnected",
  "error",
])

/** `null` when the wire does not even say which connection it describes or
 *  what state it is in — nothing here is then safe to apply. */
export function salvageSnapshot(wire: unknown): SnapshotSalvage | null {
  if (!wire || typeof wire !== "object") return null
  const record = wire as Record<string, unknown>
  const connectionId = record.connection_id
  const status = record.status
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    return null
  }
  if (typeof status !== "string" || !STATUSES.has(status)) return null
  const eventSeq = record.event_seq
  return {
    connectionId,
    status: status as ConnectionStatus,
    sessionId:
      typeof record.external_id === "string" && record.external_id.length > 0
        ? record.external_id
        : null,
    selectorsReady: record.selectors_ready === true,
    supportsFork: record.fork_supported === true,
    eventSeq:
      typeof eventSeq === "number" && Number.isFinite(eventSeq) && eventSeq > 0
        ? Math.floor(eventSeq)
        : 0,
  }
}
