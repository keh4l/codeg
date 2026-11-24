import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"
import { deflateSync } from "node:zlib"
import { WebTransport } from "./web-transport"
import {
  BOOT_PREFETCH_CALLS,
  __resetPrimedCallsForTests,
} from "../boot/boot-prefetch"

// Minimal controllable WebSocket stand-in: records instances and lets the test
// drive the lifecycle (open / __ready__ frame / drop) deterministically. The
// real browser WS is event-driven and opaque; this exposes the transitions the
// state machine reacts to.
class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []
  readyState = MockWebSocket.CONNECTING
  binaryType = "blob"
  // The subprotocol the server selected; set by a test before `open()`.
  protocol = ""
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor(
    public url: string,
    public protocols?: string | string[]
  ) {
    MockWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = MockWebSocket.CLOSED
  }
  // ── test drivers ──
  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }
  ready() {
    this.onmessage?.({
      data: JSON.stringify({ channel: "__ready__", payload: null }),
    })
  }
  drop() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

function lastWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

let fetchMock: Mock

beforeEach(() => {
  vi.useFakeTimers()
  MockWebSocket.instances = []
  vi.stubGlobal("WebSocket", MockWebSocket)
  localStorage.setItem("codeg_token", "tok")
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

// Bring a fresh transport to the application-ready "connected" state.
// `eventStream()` synchronously triggers the WS connect (no await, unlike
// `subscribe()`), which keeps the timer/promise interleaving simple.
function connectReady() {
  const t = new WebTransport("http://localhost")
  t.eventStream()
  const ws = lastWs()
  ws.open()
  ws.ready()
  return { t, ws }
}

const ok200 = () => ({ status: 200, ok: true, json: async () => ({}) })

// Fork: losing a socket that was up is retried once straight away (125–250 ms,
// no probe). Let that retry fail before it opens, so the next attempt is the
// backed-off one that probes `/api/health` (after 1–2 s).
async function dropAndFailTheQuickRetry(ws: MockWebSocket) {
  ws.drop()
  await vi.advanceTimersByTimeAsync(250)
  const retry = lastWs()
  expect(retry).not.toBe(ws)
  expect(fetchMock).not.toHaveBeenCalled()
  retry.drop()
}
// Codeg's own 401 carries its bearer challenge (`web/auth.rs`); a 401 from an
// identity-aware proxy in front of it carries the proxy's challenge instead.
const resp401 = () => ({
  status: 401,
  ok: false,
  headers: new Headers({ "WWW-Authenticate": 'Bearer realm="codeg"' }),
  json: async () => ({}),
})
const proxy401 = () => ({
  status: 401,
  ok: false,
  headers: new Headers({
    "WWW-Authenticate":
      'Cloudflare-Access resource_metadata="https://example.test/.well-known/x"',
  }),
  json: async () => ({}),
})

describe("WebTransport connection state machine", () => {
  it("starts connected and the first __ready__ does not fire reconnect callbacks", () => {
    const t = new WebTransport("http://localhost")
    const onReconnect = vi.fn()
    const onReady = vi.fn()
    t.onReconnect(onReconnect)
    t.onReady(onReady)
    expect(t.getConnectionSnapshot()).toBe("connected")

    t.eventStream()
    const ws = lastWs()
    ws.open()
    ws.ready()

    expect(t.getConnectionSnapshot()).toBe("connected")
    // First ready = initial connect, not a reconnect.
    expect(onReconnect).not.toHaveBeenCalled()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it("treats a dropped socket as reconnecting — never logs out or wipes the token", () => {
    const { t, ws } = connectReady()

    ws.drop()

    expect(t.getConnectionSnapshot()).toBe("reconnecting")
    // The token survives a transient drop (this is the whole point of the fix).
    expect(localStorage.getItem("codeg_token")).toBe("tok")
    // Probe is scheduled on backoff, not fired synchronously.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("goes straight back after losing a socket that was up; the 2nd ready fires reconnect callbacks", async () => {
    const { t, ws } = connectReady()
    const onReconnect = vi.fn()
    const onReady = vi.fn()
    t.onReconnect(onReconnect)
    t.onReady(onReady)

    ws.drop()
    await vi.advanceTimersByTimeAsync(124)
    expect(lastWs()).toBe(ws) // jittered, not instant
    await vi.advanceTimersByTimeAsync(126)
    // No health probe first: the server was just there.
    expect(fetchMock).not.toHaveBeenCalled()
    const ws2 = lastWs()
    expect(ws2).not.toBe(ws)

    ws2.open()
    ws2.ready()
    expect(t.getConnectionSnapshot()).toBe("connected")
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it("probes /api/health on backoff and reconnects on 200 when the quick retry fails", async () => {
    const { t, ws } = connectReady()
    const onReconnect = vi.fn()
    const onReady = vi.fn()
    t.onReconnect(onReconnect)
    t.onReady(onReady)
    fetchMock.mockResolvedValue(ok200())

    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000) // backoff (1–2 s) → probe

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/api/health",
      expect.objectContaining({ method: "POST" })
    )
    const ws3 = lastWs()
    expect(MockWebSocket.instances).toHaveLength(3) // a fresh socket was opened

    ws3.open()
    ws3.ready()
    expect(t.getConnectionSnapshot()).toBe("connected")
    // Reconnect (2nd ready) refreshes consumer state exactly once.
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it("starts the ladder over only once a socket has stayed up 30 s", async () => {
    const { ws } = connectReady()
    fetchMock.mockResolvedValue(ok200())

    ws.drop()
    await vi.advanceTimersByTimeAsync(250)
    const ws2 = lastWs()
    ws2.open()
    ws2.ready()
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(5_000)
      ws2.onmessage?.({ data: JSON.stringify({ type: "pong" }) })
    }

    // Up 10 s, then gone again: no second quick retry, a backed-off probe.
    ws2.drop()
    await vi.advanceTimersByTimeAsync(250)
    expect(lastWs()).toBe(ws2)
    await vi.advanceTimersByTimeAsync(1750)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const ws3 = lastWs()
    expect(ws3).not.toBe(ws2)
    ws3.open()
    ws3.ready()

    // Up 30 s (answering pings): the next loss is a quick retry again.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(5_000)
      ws3.onmessage?.({ data: JSON.stringify({ type: "pong" }) })
    }
    ws3.drop()
    await vi.advanceTimersByTimeAsync(250)
    expect(lastWs()).not.toBe(ws3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("gives up a socket that never opens and retries", async () => {
    const t = new WebTransport("http://localhost")
    fetchMock.mockResolvedValue(ok200())
    t.eventStream()
    const ws = lastWs() // never opens: a black-holed connect

    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.getConnectionSnapshot()).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastWs()).not.toBe(ws)
  })

  it("enters unauthorized on a 401 probe and stops retrying (token left intact)", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(resp401())

    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000)

    expect(t.getConnectionSnapshot()).toBe("unauthorized")
    // markUnauthorized must NOT clear the token — only the user's "Go to
    // login" action does, so a spurious 401 can't silently wipe a session.
    expect(localStorage.getItem("codeg_token")).toBe("tok")

    const callsSoFar = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock.mock.calls.length).toBe(callsSoFar) // no further probing
  })

  it("stays reconnecting on an unreachable probe and keeps backing off", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))

    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000) // first probe fails
    expect(t.getConnectionSnapshot()).toBe("reconnecting")
    const calls1 = fetchMock.mock.calls.length

    await vi.advanceTimersByTimeAsync(4000) // next backoff tick (2–4 s)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls1)
    expect(t.getConnectionSnapshot()).toBe("reconnecting")
  })

  it("reconnectNow() probes immediately without waiting for backoff", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(ok200())

    ws.drop() // schedules a probe at 1s
    t.reconnectNow() // should fire one now and cancel the scheduled one
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const ws2 = lastWs()
    ws2.open()
    ws2.ready()
    expect(t.getConnectionSnapshot()).toBe("connected")
  })

  it("de-dupes concurrent probes (a button mash fires a single fetch)", () => {
    const { t, ws } = connectReady()
    // A probe that never settles, so the in-flight guard stays set.
    fetchMock.mockReturnValue(new Promise(() => {}))

    ws.drop()
    t.reconnectNow()
    t.reconnectNow()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("aborts a hung probe at the timeout and resumes reconnecting", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockImplementation(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          )
        })
    )

    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000) // probe starts, fetch hangs
    expect(t.getConnectionSnapshot()).toBe("reconnecting")

    await vi.advanceTimersByTimeAsync(8000) // HEALTH_PROBE_TIMEOUT_MS → abort
    expect(t.getConnectionSnapshot()).toBe("reconnecting") // recovered, not hung
  })

  it("ignores a late onclose after destroy() and schedules nothing", async () => {
    const { t, ws } = connectReady()
    const lateClose = ws.onclose // capture before destroy detaches it

    t.destroy()
    lateClose?.() // simulate the browser's async close landing post-destroy

    expect(t.getConnectionSnapshot()).toBe("connected") // guard short-circuits
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).not.toHaveBeenCalled() // no backoff was scheduled
  })

  it("notifies subscribers on state change and stops after unsubscribe", () => {
    const { t, ws } = connectReady()
    const listener = vi.fn()
    const unsub = t.subscribeConnection(listener)

    ws.drop()
    expect(listener).toHaveBeenCalledTimes(1) // connected → reconnecting

    unsub()
    t.reconnectNow() // would transition, but we're unsubscribed
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("ignores a probe that resolves 200 after a definitive 401 (no resurrection)", async () => {
    const { t, ws } = connectReady()
    let resolveProbe: (v: unknown) => void = () => {}
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve
      })
    )

    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000) // probe starts, stays pending
    expect(t.getConnectionSnapshot()).toBe("reconnecting")

    // A definitive 401 arrives via another path while the probe is in flight.
    t.markUnauthorized()
    expect(t.getConnectionSnapshot()).toBe("unauthorized")

    // The stale probe now resolves 200 — it must NOT reopen the socket.
    resolveProbe(ok200())
    await vi.advanceTimersByTimeAsync(0)
    expect(t.getConnectionSnapshot()).toBe("unauthorized")
    // No socket after the failed quick retry.
    expect(MockWebSocket.instances).toHaveLength(2)

    const calls = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock.mock.calls.length).toBe(calls) // no further probing
  })

  it("treats a token cleared between probe and reconnect as unauthorized", async () => {
    const { t, ws } = connectReady()
    // The probe succeeds, but the token is gone by the time connectWs runs
    // (e.g. a logout in another tab landed mid-probe).
    fetchMock.mockImplementation(async () => {
      localStorage.removeItem("codeg_token")
      return ok200()
    })

    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000)

    // Must not dead-end in "reconnecting" with no socket and no timer.
    expect(t.getConnectionSnapshot()).toBe("unauthorized")
  })

  it("enters reconnecting when the very first connect fails (server unreachable at load)", () => {
    const t = new WebTransport("http://localhost")
    t.eventStream() // opens the socket
    const ws = lastWs()

    ws.drop() // closes before it ever opened or readied
    expect(t.getConnectionSnapshot()).toBe("reconnecting")
    expect(localStorage.getItem("codeg_token")).toBe("tok") // token preserved
  })

  it("sends X-Requested-With on health probes so a proxy answers 401, not a redirect", async () => {
    const { ws } = connectReady()
    fetchMock.mockResolvedValue(ok200())

    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000)

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok",
      "X-Requested-With": "XMLHttpRequest",
    })
  })

  it("enters proxyUnauthorized on a 401 without Codeg's challenge, keeps the token, stops retrying", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(proxy401())

    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000)

    expect(t.getConnectionSnapshot()).toBe("proxyUnauthorized")
    // The Codeg token is still valid; only the proxy's session expired.
    expect(localStorage.getItem("codeg_token")).toBe("tok")

    const callsSoFar = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock.mock.calls.length).toBe(callsSoFar)
  })
})

describe("WebTransport.call", () => {
  it("sends X-Requested-With alongside the bearer token", async () => {
    const t = new WebTransport("http://localhost")
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "{}",
    })

    await t.call("list_things")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://localhost/api/list_things")
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok",
      "X-Requested-With": "XMLHttpRequest",
    })
  })

  it("classifies a 401 by its challenge: Codeg's → unauthorized, a proxy's → proxyUnauthorized", async () => {
    const codeg = new WebTransport("http://localhost")
    fetchMock.mockResolvedValueOnce(resp401())
    await expect(codeg.call("x")).rejects.toThrow("Unauthorized")
    expect(codeg.getConnectionSnapshot()).toBe("unauthorized")

    const proxied = new WebTransport("http://localhost")
    fetchMock.mockResolvedValueOnce(proxy401())
    await expect(proxied.call("x")).rejects.toThrow("Unauthorized")
    expect(proxied.getConnectionSnapshot()).toBe("proxyUnauthorized")
  })
})

describe("WebTransport retrying a call (CallOptions.retry)", () => {
  const ok = (body: unknown) => ({
    status: 200,
    ok: true,
    text: async () => JSON.stringify(body),
  })
  type Outcome = { value: unknown } | { error: unknown }
  const outcome = (p: Promise<unknown>): Promise<Outcome> =>
    p.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )

  it("sends a call that failed on the network again, with the same key", async () => {
    const t = new WebTransport("http://localhost")
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        status: 502,
        ok: false,
        json: async () => {
          throw new SyntaxError("html")
        },
      })
      .mockResolvedValueOnce(ok({ done: true }))

    const call = t.call(
      "update_conversation_title",
      { conversationId: 1, title: "x" },
      { idempotencyKey: "k-1", retry: { attempts: 2 } }
    )
    await vi.advanceTimersByTimeAsync(2_100)
    expect(await call).toEqual({ done: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers["X-Codeg-Idempotency-Key"]).toBe("k-1")
    }
  })

  it("gives up after its attempts, or once the result is no longer wanted", async () => {
    const t = new WebTransport("http://localhost")
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    const spent = outcome(t.call("x", {}, { retry: { attempts: 1 } }))
    await vi.advanceTimersByTimeAsync(2_100)
    expect(String(((await spent) as { error: unknown }).error)).toContain(
      "Failed to fetch"
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockClear()
    let wanted = true
    const dropped = outcome(
      t.call("x", {}, { retry: { attempts: 2, stillWanted: () => wanted } })
    )
    await vi.advanceTimersByTimeAsync(100)
    wanted = false
    await vi.advanceTimersByTimeAsync(2_100)
    expect("error" in (await dropped)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not send again what the server answered, or without retry", async () => {
    const t = new WebTransport("http://localhost")
    fetchMock.mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({ code: "io_error", message: "disk" }),
    })
    const answered = outcome(t.call("x", {}, { retry: { attempts: 2 } }))
    await vi.advanceTimersByTimeAsync(2_100)
    expect(await answered).toEqual({
      error: { code: "io_error", message: "disk" },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockClear()
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    const plain = outcome(t.call("x", {}, { timeoutMs: 1_000 }))
    await vi.advanceTimersByTimeAsync(2_100)
    expect("error" in (await plain)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("WebTransport answering from the head script's batch", () => {
  type BootWindow = { __CODEG_BOOT__?: unknown }
  function prime(answer: (cmd: string) => unknown) {
    ;(window as unknown as BootWindow).__CODEG_BOOT__ = {
      at: Date.now(),
      calls: BOOT_PREFETCH_CALLS,
      batch: Promise.resolve(BOOT_PREFETCH_CALLS.map(({ cmd }) => answer(cmd))),
    }
  }
  beforeEach(() => __resetPrimedCallsForTests())
  afterEach(() => {
    delete (window as unknown as BootWindow).__CODEG_BOOT__
    __resetPrimedCallsForTests()
  })
  const text = (body: unknown) => ({
    status: 200,
    ok: true,
    text: async () => JSON.stringify(body),
  })

  it("answers a primed call without a request, once", async () => {
    prime((cmd) => ({ s: 200, b: { from: "boot", cmd } }))
    const t = new WebTransport("http://localhost")
    fetchMock.mockResolvedValue(text({ from: "server" }))

    expect(await t.call("list_folder_groups", {})).toEqual({
      from: "boot",
      cmd: "list_folder_groups",
    })
    expect(fetchMock).not.toHaveBeenCalled()

    const again = t.call("list_folder_groups", {})
    await vi.advanceTimersByTimeAsync(10)
    expect(await again).toEqual({ from: "server" })
  })

  it("asks the server when the primed answer is not a success", async () => {
    prime(() => ({ s: 500, b: { code: "io_error", message: "disk" } }))
    const t = new WebTransport("http://localhost")
    fetchMock.mockResolvedValue(text([1]))

    const read = t.call("list_folder_groups", {})
    await vi.advanceTimersByTimeAsync(10)
    expect(await read).toEqual([1])
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost/api/list_folder_groups"
    )
  })

  it("asks the server once the event socket is ready", async () => {
    prime((cmd) => ({ s: 200, b: cmd }))
    const { t } = connectReady()
    fetchMock.mockResolvedValue(text("server"))

    const read = t.call("list_opened_tabs")
    await vi.advanceTimersByTimeAsync(10)
    expect(await read).toBe("server")
  })
})

describe("WebTransport signed in through a proxy (no token)", () => {
  beforeEach(() => {
    localStorage.removeItem("codeg_token")
    localStorage.setItem("codeg_proxy_auth", "1")
  })

  it("opens the event socket without a token protocol", () => {
    const t = new WebTransport("http://localhost")
    t.eventStream()
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(lastWs().protocols).toEqual(["codeg-events.v2", "codeg-events"])
  })

  it("calls the API without an Authorization header", async () => {
    const t = new WebTransport("http://localhost")
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "{}",
    })
    await t.call("list_things")
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).not.toHaveProperty("Authorization")
  })

  it("probes health after a drop instead of declaring the session gone", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(ok200())
    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalled()
    expect(t.getConnectionSnapshot()).toBe("reconnecting")
  })

  it("treats any 401 as the proxy's: a reload is the only way back in", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(resp401())
    await dropAndFailTheQuickRetry(ws)
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.getConnectionSnapshot()).toBe("proxyUnauthorized")
  })
})

// A browser that opens the workspace directly (a bookmark, a restored tab)
// holds neither a token nor the proxy mark, though a proxy in front of the
// server may already vouch for it: HTTP calls then succeed without either,
// so only asking the server can tell whether to open the event socket.
describe("WebTransport opened without any credential", () => {
  beforeEach(() => {
    localStorage.removeItem("codeg_token")
    localStorage.removeItem("codeg_proxy_auth")
  })

  it("asks the server, and opens the socket once a proxy admits the browser", async () => {
    fetchMock.mockResolvedValue(ok200())
    const t = new WebTransport("http://localhost")
    const handler = vi.fn()
    let resolved = false
    const subscribed = t.subscribe("folders", handler).then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(0)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/health")
    expect(init.headers).not.toHaveProperty("Authorization")
    expect(localStorage.getItem("codeg_proxy_auth")).toBe("1")
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(lastWs().protocols).toEqual(["codeg-events.v2", "codeg-events"])

    // subscribe() still resolves only once the server-side receiver is in.
    lastWs().open()
    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(false)
    lastWs().ready()
    await subscribed
    expect(resolved).toBe(true)
    lastWs().onmessage?.({
      data: JSON.stringify({ channel: "folders", payload: 1 }),
    })
    expect(handler).toHaveBeenCalledWith(1)
  })

  it("changes nothing when the server wants a token, and asks only once", async () => {
    fetchMock.mockResolvedValue(resp401())
    const t = new WebTransport("http://localhost")
    t.eventStream()
    await vi.advanceTimersByTimeAsync(0)
    await t.subscribe("folders", () => {})
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(MockWebSocket.instances).toHaveLength(0)
    // No dialog: on the login page there is nothing to sign back in to.
    expect(t.getConnectionSnapshot()).toBe("connected")
    expect(localStorage.getItem("codeg_proxy_auth")).toBeNull()
  })

  it("asks again, quietly, while the server cannot be reached", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(ok200())
    const t = new WebTransport("http://localhost")
    t.eventStream()
    await vi.advanceTimersByTimeAsync(0)
    expect(MockWebSocket.instances).toHaveLength(0)
    expect(t.getConnectionSnapshot()).toBe("connected")

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it("stops asking once destroyed", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    const t = new WebTransport("http://localhost")
    t.eventStream()
    await vi.advanceTimersByTimeAsync(0)
    t.destroy()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("WebTransport heartbeat and wake verification", () => {
  it("sends a ping every 5 s and stays connected while anything comes back", async () => {
    const { t, ws } = connectReady()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(ws.sent).toContain(JSON.stringify({ action: "ping" }))
    expect(t.getConnectionSnapshot()).toBe("connected")

    // A slow pong (a retransmission, a large frame ahead of it) is fine.
    await vi.advanceTimersByTimeAsync(12_000)
    ws.onmessage?.({ data: JSON.stringify({ type: "pong" }) })
    // The next ping (at 20 s) is answered 14 s later: still in time.
    await vi.advanceTimersByTimeAsync(17_000)
    ws.onmessage?.({ data: JSON.stringify({ type: "pong" }) })
    expect(t.getConnectionSnapshot()).toBe("connected")
    expect(fetchMock).not.toHaveBeenCalled()
    t.destroy()
  })

  it("tears down a socket silent for 15 s after a ping and probes health", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(ok200())

    await vi.advanceTimersByTimeAsync(5_000)
    expect(ws.sent).toContain(JSON.stringify({ action: "ping" }))
    await vi.advanceTimersByTimeAsync(14_000)
    expect(t.getConnectionSnapshot()).toBe("connected")
    await vi.advanceTimersByTimeAsync(1_000)

    expect(t.getConnectionSnapshot()).toBe("reconnecting")
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/api/health",
      expect.objectContaining({ method: "POST" })
    )
    const ws2 = lastWs()
    expect(ws2).not.toBe(ws)
    ws2.open()
    ws2.ready()
    expect(t.getConnectionSnapshot()).toBe("connected")
    t.destroy()
  })

  it("on wake, replaces a silent socket at once when the server answers", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(ok200())

    // The laptop slept a minute: no timers ran, nothing arrived.
    vi.setSystemTime(Date.now() + 60_000)
    t.verifyConnection()
    expect(ws.sent).toContain(JSON.stringify({ action: "ping" }))
    await vi.advanceTimersByTimeAsync(499)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const ws2 = lastWs()
    expect(ws2).not.toBe(ws) // not 15 s later: now
    expect(t.getConnectionSnapshot()).toBe("reconnecting")
    ws2.open()
    ws2.ready()
    expect(t.getConnectionSnapshot()).toBe("connected")
    t.destroy()
  })

  it("on wake, keeps a socket that answers the ping", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(ok200())

    vi.setSystemTime(Date.now() + 60_000)
    t.verifyConnection()
    await vi.advanceTimersByTimeAsync(300)
    ws.onmessage?.({ data: JSON.stringify({ type: "pong" }) })
    await vi.advanceTimersByTimeAsync(5_000)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(lastWs()).toBe(ws)
    expect(t.getConnectionSnapshot()).toBe("connected")
    t.destroy()
  })

  it("on wake, leaves a recently active socket to the 15 s rule", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(ok200())

    // Nothing for 1 s only: a slow answer, not proof of a dead socket.
    await vi.advanceTimersByTimeAsync(1_000)
    t.verifyConnection()
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastWs()).toBe(ws)
    expect(t.getConnectionSnapshot()).toBe("connected")
    t.destroy()
  })

  it("verifyConnection() immediately probes when already reconnecting and ignores unauthorized", async () => {
    const { t, ws } = connectReady()
    fetchMock.mockResolvedValue(ok200())

    ws.drop()
    t.verifyConnection()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    t.markUnauthorized()
    fetchMock.mockClear()
    t.verifyConnection()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()
    t.destroy()
  })
})

describe("WebTransport on protocol v2", () => {
  function zlibFrame(value: unknown): ArrayBuffer {
    const stream = deflateSync(Buffer.from(JSON.stringify(value), "utf8"))
    const out = new Uint8Array(stream.length + 1)
    out[0] = 0x01
    out.set(stream, 1)
    return out.buffer
  }

  it("offers v2, reads compressed frames, and keeps their order with text", async () => {
    const t = new WebTransport("http://localhost")
    const seen: unknown[] = []
    const subscribed = t.subscribe<number>("numbers", (n) => seen.push(n))
    const ws = lastWs()
    expect(ws.protocols?.slice(0, 2)).toEqual([
      "codeg-events.v2",
      "codeg-events",
    ])
    expect(ws.binaryType).toBe("arraybuffer")
    ws.protocol = "codeg-events.v2"
    ws.open()
    ws.ready()
    await subscribed
    expect(t.usesProtocolV2()).toBe(true)

    ws.onmessage?.({ data: zlibFrame({ channel: "numbers", payload: 1 }) })
    ws.onmessage?.({
      data: JSON.stringify({ channel: "numbers", payload: 2 }),
    })
    ws.onmessage?.({ data: zlibFrame({ channel: "numbers", payload: 3 }) })
    await vi.waitFor(() => expect(seen).toEqual([1, 2, 3]))
    t.destroy()
  })

  it("stays on v1 with a server that selects it", () => {
    const { t } = connectReady()
    expect(t.usesProtocolV2()).toBe(false)
    t.destroy()
  })

  it("asks for the slim snapshot shape on attach (fork, wire 2)", () => {
    const { t, ws } = connectReady()
    t.eventStream().attach(
      "c1",
      {},
      {
        onSnapshot: () => {},
        onReplay: () => {},
        onEvent: () => {},
        onDetached: () => {},
      }
    )
    const attach = ws.sent
      .map((text) => JSON.parse(text))
      .find((frame) => frame.action === "attach")
    expect(attach).toMatchObject({ connection_id: "c1", wire: 2 })
    t.destroy()
  })
})
