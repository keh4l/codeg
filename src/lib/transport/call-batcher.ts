// keh4l build: quick reads sent together (`POST /api/batch`).
//
// Over HTTP/1.1 a browser sends at most six requests to a server at a time,
// so a burst of small reads — the ~30 a workspace makes as it loads, the
// lists re-read after a reconnect, the touches of every open conversation —
// went out in waves, a round trip each over a slow link. Reads known to be
// quick and safe to repeat, made within `BATCH_WINDOW_MS` of each other, now
// go out as one request; the server hands each to the route it would have
// reached alone and answers them all together. Each call settles exactly as
// it would have alone: its value, its error, a 401 that brings up the
// sign-in dialog.
//
// A call the server did not finish in time (`deferred`), a batch the server
// cannot read, or one that failed on the server's side, is sent again alone.
// A server without the endpoint (404 / 501) turns batching off for good. A
// hidden page sends directly: its timers are throttled, and a batch must not
// hold back the keepalive touches.

import { parseJsonOrThrow } from "../json-parse-error"

/** Reads that answer from the database or memory in milliseconds and change
 *  nothing (a touch only marks a connection as in use). Anything slow, big or
 *  with an effect is sent alone. */
export const BATCHABLE_COMMANDS: ReadonlySet<string> = new Set([
  "acp_get_session_flags",
  "acp_touch_connection",
  "app_update_state",
  "app_update_status",
  "assistant_list",
  "automation_list",
  "browser_bridge_status",
  "computer_available",
  "follow_up_list",
  "follow_up_steers",
  "get_codeg_mcp_service_status",
  "get_conversation_branch_tag",
  "get_git_head",
  "get_system_language_settings",
  "get_system_terminal_settings",
  "get_tab_sync_settings",
  "get_translation_settings",
  "harness_status",
  "list_all_conversations",
  "list_all_folder_details",
  "list_conversation_tags",
  "list_folder_commands",
  "list_folder_groups",
  "list_open_folder_details",
  "list_opened_tabs",
  "work_task_list",
])

export const BATCH_WINDOW_MS = 8
const MAX_BATCH_CALLS = 48

/** One call's answer from the server (`web/handlers/batch.rs`). */
interface BatchResult {
  s?: number
  b?: unknown
  t?: string
  w?: string
  d?: boolean
}

export interface CallBatcherDeps {
  /** POST the batch; rejects as a direct call's fetch would. */
  sendBatch: (
    calls: { cmd: string; args: Record<string, unknown> }[]
  ) => Promise<Response>
  /** The call sent alone. */
  callDirect: (
    command: string,
    args: Record<string, unknown> | undefined
  ) => Promise<unknown>
  /** A 401: which part answered it (its `WWW-Authenticate`). */
  onUnauthorized: (challenge: string | null) => void
  /** Whether the page is hidden right now. */
  isHidden?: () => boolean
  windowMs?: number
}

interface Pending {
  command: string
  args: Record<string, unknown> | undefined
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export class CallBatcher {
  private queue: Pending[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private disabled = false

  constructor(private readonly deps: CallBatcherDeps) {}

  /** Whether `call` would batch `command` (it is quick, and batching is on). */
  accepts(command: string): boolean {
    return !this.disabled && BATCHABLE_COMMANDS.has(command)
  }

  call(
    command: string,
    args: Record<string, unknown> | undefined
  ): Promise<unknown> {
    if (this.disabled || this.deps.isHidden?.()) {
      return this.deps.callDirect(command, args)
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ command, args, resolve, reject })
      if (this.queue.length >= MAX_BATCH_CALLS) {
        this.flushNow()
      } else if (this.timer == null) {
        this.timer = setTimeout(
          () => this.flushNow(),
          this.deps.windowMs ?? BATCH_WINDOW_MS
        )
      }
    })
  }

  private flushNow(): void {
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const batch = this.queue.splice(0, MAX_BATCH_CALLS)
    if (this.queue.length > 0) {
      this.timer = setTimeout(() => this.flushNow(), 0)
    }
    if (batch.length === 0) return
    if (batch.length === 1) {
      this.direct(batch[0]!)
      return
    }
    void this.send(batch)
  }

  private direct(pending: Pending): void {
    this.deps
      .callDirect(pending.command, pending.args)
      .then(pending.resolve, pending.reject)
  }

  private async send(batch: Pending[]): Promise<void> {
    let res: Response
    try {
      res = await this.deps.sendBatch(
        batch.map((p) => ({ cmd: p.command, args: p.args ?? {} }))
      )
    } catch (err) {
      for (const pending of batch) pending.reject(err)
      return
    }
    if (res.status === 401) {
      this.deps.onUnauthorized(res.headers.get("www-authenticate"))
      for (const pending of batch) pending.reject(new Error("Unauthorized"))
      return
    }
    if (res.status === 404 || res.status === 501) {
      this.disabled = true
      for (const pending of batch) this.direct(pending)
      return
    }
    let results: BatchResult[] | null = null
    if (res.ok) {
      try {
        const parsed = JSON.parse(await res.text()) as { results?: unknown }
        if (
          Array.isArray(parsed.results) &&
          parsed.results.length === batch.length
        ) {
          results = parsed.results as BatchResult[]
        }
      } catch {
        results = null
      }
    }
    if (!results) {
      for (const pending of batch) this.direct(pending)
      return
    }
    batch.forEach((pending, i) => this.settle(pending, results[i]!))
  }

  private settle(pending: Pending, result: BatchResult): void {
    if (result.d || typeof result.s !== "number") {
      this.direct(pending)
      return
    }
    const status = result.s
    if (status === 401) {
      this.deps.onUnauthorized(result.w ?? null)
      pending.reject(new Error("Unauthorized"))
      return
    }
    if (status < 200 || status >= 300) {
      pending.reject(
        result.b !== undefined
          ? result.b
          : { code: "network_error", message: `HTTP ${status}` }
      )
      return
    }
    if (result.b !== undefined) {
      pending.resolve(result.b)
      return
    }
    try {
      pending.resolve(
        parseJsonOrThrow(result.t ?? "", `API ${pending.command}`)
      )
    } catch (err) {
      pending.reject(err)
    }
  }
}
