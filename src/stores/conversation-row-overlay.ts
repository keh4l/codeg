// keh4l build: sidebar row changes made here and not yet confirmed.
//
// An instant rename, pin or status change patches the row at once
// (`updateConversationLocal`). A list read the server answered before the
// change reached it would put the old value back for a moment, so each
// pending change is held here and laid over every row the server sends
// (`overlayConversations` / `overlayConversation`, used by the list read and
// the upsert broadcast) until a row from the server shows it — normally the
// change's own broadcast — or the request fails (`release`), or
// `SETTLED_HOLD_MS` after it succeeded (`settle`).

import type { DbConversationSummary } from "@/lib/types"

type Field = "title" | "status" | "pinned_at"
type Value = DbConversationSummary[Field]

interface Held {
  id: number
  field: Field
  value: Value
  token: symbol
}

/** How long a change that succeeded is still held without a confirming row. */
export const SETTLED_HOLD_MS = 5_000

const held = new Map<string, Held>()

const keyOf = (id: number, field: Field) => `${id}:${field}`

/** Whether `row` already shows the held value (a pin is about being pinned,
 *  not the exact time the server stamped). */
function shows(row: DbConversationSummary, entry: Held): boolean {
  if (entry.field === "pinned_at") {
    return (row.pinned_at == null) === (entry.value == null)
  }
  return row[entry.field] === entry.value
}

export interface ConversationFieldHold {
  /** The request succeeded: stop holding soon. */
  settle(): void
  /** The request failed: stop holding now. */
  release(): void
}

/** Hold `field` of row `id` at `value` until the server confirms it. A newer
 *  hold on the same field replaces this one. */
export function holdConversationField<F extends Field>(
  id: number,
  field: F,
  value: DbConversationSummary[F]
): ConversationFieldHold {
  const key = keyOf(id, field)
  const token = Symbol(key)
  held.set(key, { id, field, value, token })
  const drop = () => {
    if (held.get(key)?.token === token) held.delete(key)
  }
  return {
    settle: () => {
      setTimeout(drop, SETTLED_HOLD_MS)
    },
    release: drop,
  }
}

function overlay(row: DbConversationSummary): DbConversationSummary {
  let next = row
  for (const field of ["title", "status", "pinned_at"] as const) {
    const key = keyOf(row.id, field)
    const entry = held.get(key)
    if (!entry) continue
    if (shows(row, entry)) {
      held.delete(key)
      continue
    }
    next = { ...next, [field]: entry.value }
  }
  return next
}

/** A row from the server, with the changes still held laid over it. */
export function overlayConversation(
  row: DbConversationSummary
): DbConversationSummary {
  return held.size === 0 ? row : overlay(row)
}

/** Rows from the server, with the changes still held laid over them. */
export function overlayConversations(
  rows: DbConversationSummary[]
): DbConversationSummary[] {
  return held.size === 0 ? rows : rows.map(overlay)
}

/** @internal Test-only. */
export function __resetConversationHoldsForTests() {
  held.clear()
}
