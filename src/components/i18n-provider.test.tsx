import { useEffect } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SystemLanguageSettings } from "@/lib/types"

const api = vi.hoisted(() => ({
  getSystemLanguageSettings: vi.fn<() => Promise<SystemLanguageSettings>>(),
}))
vi.mock("@/lib/api", () => api)

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppI18nProvider } from "./i18n-provider"

function renderTabs() {
  render(
    <AppI18nProvider>
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
        </TabsList>
        <TabsContent value="one">Body</TabsContent>
      </Tabs>
    </AppI18nProvider>
  )
}

const tabsRoot = () => screen.getByText("Body").closest('[data-slot="tabs"]')

describe("AppI18nProvider direction", () => {
  afterEach(() => {
    document.documentElement.dir = ""
    window.localStorage.clear()
  })

  // Radix components read their direction from context, not from the page:
  // without a provider a Tabs root stamps `dir="ltr"` on itself, and
  // everything inside it — switches, rows, menus — stays left-to-right in an
  // Arabic window whose page is right-to-left.
  it("hands Radix components the page's right-to-left direction", async () => {
    api.getSystemLanguageSettings.mockResolvedValue({
      mode: "manual",
      language: "ar",
    })
    renderTabs()
    await waitFor(() => expect(tabsRoot()).toHaveAttribute("dir", "rtl"))
    expect(document.documentElement.dir).toBe("rtl")
  })

  it("keeps them left-to-right otherwise", async () => {
    api.getSystemLanguageSettings.mockResolvedValue({
      mode: "manual",
      language: "en",
    })
    renderTabs()
    await waitFor(() => expect(tabsRoot()).toHaveAttribute("dir", "ltr"))
    expect(document.documentElement.dir).toBe("ltr")
  })
})

describe("AppI18nProvider boot (fork)", () => {
  const forget = () => {
    window.localStorage.clear()
    document.cookie = "codeg.locale=; Max-Age=0; Path=/"
    document.cookie = "codeg.language_mode=; Max-Age=0; Path=/"
  }
  beforeEach(forget)
  afterEach(forget)

  it("renders without waiting for the server's language settings", async () => {
    window.localStorage.setItem(
      "codeg.system_language_settings",
      JSON.stringify({ mode: "manual", language: "en" })
    )
    api.getSystemLanguageSettings.mockReturnValue(new Promise(() => {}))
    render(
      <AppI18nProvider>
        <p>workspace</p>
      </AppI18nProvider>
    )
    expect(await screen.findByText("workspace")).toBeTruthy()
    // Nothing from the server yet: no cookies written on a guess.
    expect(document.cookie).not.toContain("codeg.locale=")
  })

  it("switches language without unmounting what it renders", async () => {
    let answer!: (settings: SystemLanguageSettings) => void
    api.getSystemLanguageSettings.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    let mounts = 0
    function Probe() {
      useEffect(() => {
        mounts += 1
      }, [])
      return <p>workspace</p>
    }
    render(
      <AppI18nProvider>
        <Probe />
      </AppI18nProvider>
    )
    await screen.findByText("workspace")
    await act(async () => {
      answer({ mode: "manual", language: "ar" })
    })
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"))
    expect(screen.getByText("workspace")).toBeTruthy()
    expect(mounts).toBe(1)
    expect(document.cookie).toContain("codeg.locale=ar")
  })
})
