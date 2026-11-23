import { describe, expect, it, vi } from "vitest"

import { BOOT_INIT_SCRIPT } from "./boot-script"

/** Run the script as a page would, against a stand-in window. */
function run(options: {
  path: string
  search?: string
  hash?: string
  token?: string
  proxy?: boolean
  tauri?: boolean
}) {
  const replace = vi.fn()
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
  new Function("window", "location", "localStorage", BOOT_INIT_SCRIPT)(
    win,
    location,
    localStorage
  )
  return replace
}

describe("BOOT_INIT_SCRIPT", () => {
  it("sends a browser with a token from / to /workspace", () => {
    expect(run({ path: "/", token: "t" })).toHaveBeenCalledWith("/workspace")
  })

  it("does the same for a browser a proxy admitted", () => {
    expect(run({ path: "/", proxy: true })).toHaveBeenCalledWith("/workspace")
  })

  it("leaves everything else to the pages", () => {
    expect(run({ path: "/" })).not.toHaveBeenCalled()
    expect(run({ path: "/", token: "t", tauri: true })).not.toHaveBeenCalled()
    expect(
      run({ path: "/", token: "t", search: "?x=1" })
    ).not.toHaveBeenCalled()
    expect(run({ path: "/", token: "t", hash: "#a" })).not.toHaveBeenCalled()
    expect(run({ path: "/login", token: "t" })).not.toHaveBeenCalled()
    expect(run({ path: "/workspace", token: "t" })).not.toHaveBeenCalled()
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
