// keh4l build: the workspace's first reads, asked for by the page's first
// script (`boot-script.ts`) before any chunk has loaded.
//
// A warm load of /workspace spent its first ~0.6 s getting the document and
// running the (cached) scripts before the workspace asked the server for
// anything, and then waited a round trip for the answers. The head script now
// sends these reads as one batch (`POST /api/batch`) as soon as the document
// starts, and the web transport answers the workspace's first matching calls
// from it (`takePrimedCall`): each once, only within `PRIMED_FOR_MS` of the
// request, and only until the event socket is first ready. Reads made after
// that may be the ones that close the gap between a snapshot and a
// subscription going live (`tab-context.tsx`, `tab-sync-prefs.ts`), so they
// always go to the server.
//
// A call whose arguments differ, a failed batch (a 401 included: the
// workspace's own call then meets it and brings up the sign-in dialog), or an
// answer that is not a success, falls back to an ordinary call.

/** Reads every workspace makes as it loads, with the arguments it uses. */
export const BOOT_PREFETCH_CALLS: ReadonlyArray<{
  cmd: string
  args: Record<string, unknown>
}> = [
  { cmd: "list_open_folder_details", args: {} },
  { cmd: "list_all_folder_details", args: {} },
  { cmd: "list_folder_groups", args: {} },
  {
    cmd: "list_all_conversations",
    args: {
      folderIds: null,
      agentType: null,
      search: null,
      sortBy: null,
      status: null,
      includeChildren: null,
    },
  },
  { cmd: "list_opened_tabs", args: {} },
  { cmd: "get_tab_sync_settings", args: {} },
  { cmd: "list_conversation_tags", args: {} },
  { cmd: "get_conversation_branch_tag", args: {} },
  { cmd: "assistant_list", args: {} },
  { cmd: "get_system_terminal_settings", args: {} },
  { cmd: "get_translation_settings", args: {} },
  { cmd: "get_system_language_settings", args: {} },
  { cmd: "work_task_list", args: { folderId: null } },
  { cmd: "automation_list", args: {} },
  { cmd: "harness_status", args: {} },
  { cmd: "browser_bridge_status", args: {} },
  { cmd: "computer_available", args: {} },
  { cmd: "get_codeg_mcp_service_status", args: {} },
  { cmd: "app_update_status", args: {} },
  { cmd: "app_update_state", args: {} },
]

/** How long after its request a primed answer may stand in for a call. */
export const PRIMED_FOR_MS = 10_000

/** What the head script leaves on `window.__CODEG_BOOT__`. */
export interface BootPrefetch {
  at: number
  calls: { cmd: string; args: Record<string, unknown> }[]
  /** One result per call (`web/handlers/batch.rs`), or null on any failure. */
  batch: Promise<unknown[] | null>
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

/** A call's identity: its command and its arguments (absent = `{}`). */
export function callKey(
  command: string,
  args: Record<string, unknown> | undefined
): string {
  return `${command} ${stable(args ?? {})}`
}

let primed: Map<string, Promise<unknown>> | null = null
let primedAt = 0

function primedCalls(): Map<string, Promise<unknown>> {
  if (primed) return primed
  primed = new Map()
  const boot =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as { __CODEG_BOOT__?: BootPrefetch }).__CODEG_BOOT__
  if (
    !boot ||
    typeof boot.at !== "number" ||
    !Array.isArray(boot.calls) ||
    !boot.batch
  ) {
    return primed
  }
  primedAt = boot.at
  boot.calls.forEach((call, i) => {
    primed!.set(
      callKey(call.cmd, call.args),
      boot.batch.then(
        (results) => results?.[i] ?? null,
        () => null
      )
    )
  })
  return primed
}

/**
 * The head script's answer to this call, once: a promise of its batch
 * result (`null` when there is none), or `null` when the call was not asked
 * for, was already taken, or was asked for too long ago.
 */
export function takePrimedCall(
  command: string,
  args: Record<string, unknown> | undefined
): Promise<unknown> | null {
  const calls = primedCalls()
  if (calls.size === 0) return null
  if (Date.now() - primedAt > PRIMED_FOR_MS) {
    calls.clear()
    return null
  }
  const key = callKey(command, args)
  const hit = calls.get(key)
  if (!hit) return null
  calls.delete(key)
  return hit
}

/** No primed answer is used from here on (the event socket is ready). */
export function dropPrimedCalls(): void {
  primedCalls().clear()
}

/** A batch result (`web/handlers/batch.rs`) as the call's value, when it is
 *  a success; `null` sends the call to the server instead. */
export function primedValue(result: unknown): { value: unknown } | null {
  if (!result || typeof result !== "object") return null
  const r = result as { s?: unknown; b?: unknown; t?: unknown; d?: unknown }
  if (r.d || typeof r.s !== "number" || r.s < 200 || r.s >= 300) return null
  if (r.b !== undefined) return { value: r.b }
  if (typeof r.t !== "string") return null
  try {
    return { value: JSON.parse(r.t) as unknown }
  } catch {
    return null
  }
}

/** @internal Test-only. */
export function __resetPrimedCallsForTests() {
  primed = null
  primedAt = 0
}
