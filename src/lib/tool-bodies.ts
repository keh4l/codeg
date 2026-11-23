/**
 * Tool bodies the server shortened (fork, `web::body_caps`).
 *
 * Over a network the server sends a long tool input or output — a log printed
 * whole, a file written in one call — as its start and end around a `…`, with
 * a {@link ToolBodyRef} to the full text. This module keeps the references
 * right as live events revise a call, loads a full text when the reader asks
 * for it (once per text, shared by every row showing it), and puts it back in
 * place of the shortened one.
 */
import { useSyncExternalStore } from "react"

import type { AdaptedToolCallPart } from "@/lib/adapters/ai-elements-adapter"
import { getBlobText } from "@/lib/api"
import type { ToolBodyRef } from "@/lib/types"

/** The shortened bodies of a live tool call (`ToolCallInfo.body_refs`). */
export interface ToolCallBodyRefs {
  /** Its raw output. */
  output?: ToolBodyRef
  /** Its raw input. */
  input?: ToolBodyRef
  content?: ToolBodyRef
}

/** `body_refs` of a live `tool_call` / `tool_call_update` event. */
export interface WireToolBodyRefs {
  raw_output?: ToolBodyRef
  raw_input?: ToolBodyRef
  content?: ToolBodyRef
}

function compact(refs: ToolCallBodyRefs): ToolCallBodyRefs | undefined {
  const out: ToolCallBodyRefs = {}
  if (refs.output) out.output = refs.output
  if (refs.input) out.input = refs.input
  if (refs.content) out.content = refs.content
  return out.output || out.input || out.content ? out : undefined
}

/** References of a call a `tool_call` event creates. */
export function bodyRefsFromEvent(
  refs: WireToolBodyRefs | null | undefined
): ToolCallBodyRefs | undefined {
  if (!refs) return undefined
  return compact({
    output: refs.raw_output,
    input: refs.raw_input,
    content: refs.content,
  })
}

/**
 * References after an update: each body the update replaces takes the
 * update's reference (or none); output appended to a shortened body leaves a
 * text no reference describes, so that reference goes; the rest stay.
 */
export function mergeToolCallBodyRefs(
  previous: ToolCallBodyRefs | undefined,
  update: {
    raw_output: string | null
    raw_output_append?: boolean
    content: string | null
    raw_input: string | null
    body_refs?: WireToolBodyRefs | null
  }
): ToolCallBodyRefs | undefined {
  if (!previous && !update.body_refs) return undefined
  const refs = update.body_refs ?? {}
  return compact({
    output:
      update.raw_output === null
        ? previous?.output
        : update.raw_output_append
          ? undefined
          : refs.raw_output,
    content: update.content === null ? previous?.content : refs.content,
    input: update.raw_input === null ? previous?.input : refs.raw_input,
  })
}

/** How many more lines the full body has than the shortened one shown. */
export function extraLines(ref: ToolBodyRef | undefined): number {
  return ref && Number.isFinite(ref.extra_lines) ? ref.extra_lines : 0
}

// ── Loading full bodies ─────────────────────────────────────────────────────

export type ToolBodyState =
  | { status: "loading" }
  | { status: "loaded"; text: string }
  | { status: "failed" }

/** Full texts kept, least recently loaded dropped past these. */
const MAX_ENTRIES = 64
const MAX_CHARS = 64 * 1024 * 1024

const entries = new Map<string, ToolBodyState>()
const listeners = new Set<() => void>()
let keptChars = 0

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function set(id: string, state: ToolBodyState) {
  const previous = entries.get(id)
  if (previous?.status === "loaded") keptChars -= previous.text.length
  entries.delete(id)
  entries.set(id, state)
  if (state.status === "loaded") keptChars += state.text.length
  for (const [oldest, old] of entries) {
    if (entries.size <= MAX_ENTRIES && keptChars <= MAX_CHARS) break
    if (oldest === id || old.status === "loading") continue
    if (old.status === "loaded") keptChars -= old.text.length
    entries.delete(oldest)
  }
  emit()
}

/** Load the full text behind `ref` (once; a failed load can be retried). */
export function loadToolBody(ref: ToolBodyRef): Promise<string | null> {
  const known = entries.get(ref.id)
  if (known?.status === "loaded") return Promise.resolve(known.text)
  if (known?.status === "loading") {
    return new Promise((resolve) => {
      const unsubscribe = subscribe(() => {
        const now = entries.get(ref.id)
        if (now?.status === "loading") return
        unsubscribe()
        resolve(now?.status === "loaded" ? now.text : null)
      })
    })
  }
  set(ref.id, { status: "loading" })
  return getBlobText(ref.id).then(
    (text) => {
      set(ref.id, { status: "loaded", text })
      return text
    },
    (error: unknown) => {
      console.warn("[tool-bodies] could not load a full tool body:", error)
      set(ref.id, { status: "failed" })
      return null
    }
  )
}

/** Load every body of `refs`. */
export function loadToolBodies(refs: {
  input?: ToolBodyRef
  output?: ToolBodyRef
}): void {
  if (refs.input) void loadToolBody(refs.input)
  if (refs.output) void loadToolBody(refs.output)
}

function stateOf(ref: ToolBodyRef | undefined): ToolBodyState | undefined {
  return ref ? entries.get(ref.id) : undefined
}

/** Where the full text behind `ref` stands (`undefined`: not asked for). */
export function useToolBodyState(
  ref: ToolBodyRef | undefined
): ToolBodyState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => stateOf(ref),
    () => undefined
  )
}

/**
 * Valid JSON is what a shortened JSON body stays, and what a live call's
 * input may have had merged into it on this side (a title folded in as a
 * field): the full input keeps those fields.
 */
function fullInput(shortened: string | null, full: string): string {
  if (!shortened) return full
  try {
    const short: unknown = JSON.parse(shortened)
    const whole: unknown = JSON.parse(full)
    if (
      short &&
      whole &&
      typeof short === "object" &&
      typeof whole === "object" &&
      !Array.isArray(short) &&
      !Array.isArray(whole)
    ) {
      const merged: Record<string, unknown> = { ...whole }
      for (const [key, value] of Object.entries(short)) {
        if (!(key in merged)) merged[key] = value
      }
      return JSON.stringify(merged)
    }
  } catch {
    // Not JSON on both sides: the full text as it is.
  }
  return full
}

/**
 * `part` with the full texts loaded so far in place of the shortened ones
 * (and their references gone); `part` itself when there are none.
 */
export function withFullBodies(
  part: AdaptedToolCallPart,
  input: string | null,
  output: string | null
): AdaptedToolCallPart {
  if (input === null && output === null) return part
  const next: AdaptedToolCallPart = { ...part }
  const refs = { ...part.bodyRefs }
  if (input !== null) {
    next.input = fullInput(part.input, input)
    delete refs.input
  }
  if (output !== null) {
    if (part.errorText !== undefined && part.errorText === part.output) {
      next.errorText = output
    }
    if (part.output != null) next.output = output
    delete refs.output
  }
  if (refs.input || refs.output) next.bodyRefs = refs
  else delete next.bodyRefs
  return next
}

/** The full texts of `part`'s shortened bodies loaded so far. */
export function useLoadedBodies(part: AdaptedToolCallPart): {
  input: string | null
  output: string | null
} {
  const input = useToolBodyState(part.bodyRefs?.input)
  const output = useToolBodyState(part.bodyRefs?.output)
  return {
    input: input?.status === "loaded" ? input.text : null,
    output: output?.status === "loaded" ? output.text : null,
  }
}

/** `value` (a detail, turns, anything holding blocks) with every shortened
 *  tool body whole: what an export writes. The input is left as it was; a
 *  body that no longer loads stays shortened. */
export async function withFullToolBodies<T>(value: T): Promise<T> {
  const loads: Promise<void>[] = []
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit)
    if (!node || typeof node !== "object") return node
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) {
      if (key !== "body_refs") out[key] = visit(child)
    }
    const refs = (node as { body_refs?: Record<string, ToolBodyRef> }).body_refs
    for (const [field, ref] of Object.entries(refs ?? {})) {
      loads.push(
        loadToolBody(ref).then((text) => {
          if (text !== null) out[field] = text
        })
      )
    }
    return out
  }
  const result = visit(value) as T
  await Promise.all(loads)
  return result
}

/** Test hook: forget every loaded body. */
export function __resetToolBodiesForTests(): void {
  entries.clear()
  keptChars = 0
  emit()
}
