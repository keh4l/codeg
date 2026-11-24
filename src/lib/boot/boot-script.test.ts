import { describe, expect, it, vi } from "vitest"

import { BOOT_PREFETCH_CALLS } from "./boot-prefetch"
import { BOOT_INIT_SCRIPT } from "./boot-script"

/** Run the script as a page would, against a stand-in window. */
function run(options: {
  path: string
  search?: string
  hash?: string
  token?: string
  proxy?: boolean
  tauri?: boolean
  answer?: () => Promise<unknown>
}) {
  const replace = vi.fn()
  const fetch = vi.fn(
    options.answer ??
      (() => Promise.resolve(new Response("{}", { status: 404 })))
  )
  const storage = new Map<string, string>()
  if (options.token) storage.set("codeg_token", options.token)
  if (options.proxy) storage.set("codeg_proxy_auth", "1")
  const win: Record<string, unknown> = {}
  if (options.tauri) win.__TAURI_INTERNALS__ = {}
  const location = {
    pathname: options.path,
    search: options.search ?? "",
    hash: options.hash ?? "",
    replace,
  }
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null }
  new Function("window", "location", "localStorage", "fetch", BOOT_INIT_SCRIPT)(
    win,
    location,
    localStorage,
    fetch
  )
  return { replace, fetch, win }
}

function results(n: number) {
  return Array.from({ length: n }, (_, i) => ({ s: 200, b: i }))
}

describe("BOOT_INIT_SCRIPT", () => {
  it("sends a browser with a token from / to /workspace", () => {
    expect(run({ path: "/", token: "t" }).replace).toHaveBeenCalledWith(
      "/workspace"
    )
  })

  it("does the same for a browser a proxy admitted", () => {
    expect(run({ path: "/", proxy: true }).replace).toHaveBeenCalledWith(
      "/workspace"
    )
  })

  it("leaves everything else to the pages", () => {
    for (const options of [
      { path: "/" },
      { path: "/", token: "t", tauri: true },
      { path: "/", token: "t", search: "?x=1" },
      { path: "/", token: "t", hash: "#a" },
      { path: "/login", token: "t" },
      { path: "/workspace", token: "t" },
    ]) {
      expect(
        run(options).replace,
        JSON.stringify(options)
      ).not.toHaveBeenCalled()
    }
  })

  it("asks for the workspace's first reads on /workspace, as one batch", async () => {
    const answer = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ results: results(BOOT_PREFETCH_CALLS.length) }),
          { status: 200 }
        )
      )
    const { fetch, win } = run({ path: "/workspace/", token: "t", answer })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/batch")
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Authorization: "Bearer t",
    })
    expect(JSON.parse(init.body as string)).toEqual({
      calls: BOOT_PREFETCH_CALLS,
    })
    const boot = win.__CODEG_BOOT__ as {
      at: number
      calls: unknown
      batch: Promise<unknown>
    }
    expect(boot.calls).toEqual(BOOT_PREFETCH_CALLS)
    expect(typeof boot.at).toBe("number")
    expect(await boot.batch).toEqual(results(BOOT_PREFETCH_CALLS.length))
  })

  it("sends no token for a browser a proxy admitted", () => {
    const { fetch } = run({ path: "/workspace", proxy: true })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).not.toHaveProperty("Authorization")
  })

  it("leaves null for a batch that fails or answers oddly", async () => {
    for (const answer of [
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Promise.resolve(new Response("", { status: 401 })),
      () => Promise.resolve(new Response("<html>", { status: 200 })),
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ results: results(1) }), {
            status: 200,
          })
        ),
    ]) {
      const { win } = run({ path: "/workspace", token: "t", answer })
      expect(
        await (win.__CODEG_BOOT__ as { batch: Promise<unknown> }).batch
      ).toBeNull()
    }
  })

  it("asks for nothing without credentials or in the desktop app", () => {
    expect(run({ path: "/workspace" }).fetch).not.toHaveBeenCalled()
    expect(
      run({ path: "/workspace", token: "t", tauri: true }).fetch
    ).not.toHaveBeenCalled()
    expect(run({ path: "/settings", token: "t" }).fetch).not.toHaveBeenCalled()
  })

  it("never throws", () => {
    expect(() =>
      new Function("window", "location", "localStorage", BOOT_INIT_SCRIPT)(
        {},
        { pathname: "/", search: "", hash: "" },
        {
          getItem: () => {
            throw new Error("blocked")
          },
        }
      )
    ).not.toThrow()
  })
})
