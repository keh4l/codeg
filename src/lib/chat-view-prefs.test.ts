import { beforeEach, describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { APPEARANCE_INIT_SCRIPT } from "./appearance-script"
import {
  readChatViewPrefs,
  STORAGE_KEY_CHAT_VIEW_PREFS,
  useChatViewPrefs,
  writeChatViewPrefs,
} from "./chat-view-prefs"
import { EDITOR_CANVAS_BG, EDITOR_LINE_HIGHLIGHT } from "./monaco-themes"
import {
  THEME_COLOR_PREVIEW,
  THEME_COLOR_TITLE,
  THEME_COLORS,
} from "./theme-presets"

describe("chat-view-prefs", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("persists and notifies live changes without reload", () => {
    const { result } = renderHook(() => useChatViewPrefs())
    expect(result.current.toolVisibility).toBe("showAll")
    expect(result.current.liveSpeed).toBe(false)
    expect(result.current.minimap).toBe(true)

    act(() => {
      writeChatViewPrefs({
        view: "compact",
        toolVisibility: "hideSuccessful",
        liveSpeed: true,
        minimap: false,
      })
    })

    expect(result.current).toEqual({
      view: "compact",
      toolVisibility: "hideSuccessful",
      liveSpeed: true,
      minimap: false,
    })
    expect(readChatViewPrefs()).toEqual(result.current)
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY_CHAT_VIEW_PREFS)!)
    ).toEqual(result.current)
  })
})

describe("carbon (pure black) theme preset", () => {
  it("is wired into theme presets, pre-paint script, and Monaco themes", () => {
    expect(THEME_COLORS).toContain("carbon")
    expect(THEME_COLOR_PREVIEW.carbon).toBe("#000000")
    expect(THEME_COLOR_TITLE.carbon).toBeDefined()
    expect(EDITOR_CANVAS_BG.carbon.dark).toBe("#141414")
    expect(EDITOR_LINE_HIGHLIGHT.carbon.dark).toBe("#1f1f1f")
    expect(APPEARANCE_INIT_SCRIPT).toContain('"carbon"')
  })
})
