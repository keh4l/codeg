"use client"

import {
  LayoutGrid,
  Monitor,
  Moon,
  MoveHorizontal,
  Sparkles,
  Sun,
  Type,
} from "lucide-react"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  useThemeColor,
  useZoomLevel,
  useWelcomeQuickActions,
  useChatAnimationsSetting,
  useChatContentWidth,
} from "@/hooks/use-appearance"
import {
  CHAT_CONTENT_DEFAULT,
  CHAT_CONTENT_MIN,
  chatContentWidthCeiling,
} from "@/lib/chat-content-width"
import { cn } from "@/lib/utils"
import {
  SETTINGS_FORM_WIDTH,
  SettingsGroup,
  SettingsPageHeader,
  SettingsSection,
} from "@/components/shared/settings-section"
import {
  DEFAULT_ZOOM_LEVEL,
  THEME_COLOR_PREVIEW,
  THEME_COLORS,
  ZOOM_LEVELS,
  type ThemeColor,
  type ZoomLevel,
} from "@/lib/theme-presets"
import { PetManagerSection } from "./pet-manager-section"
import { FontSettingsSection } from "./font-settings-section"
import { WorkspaceBackgroundSection } from "./workspace-background-section"
import { CustomStyleSection } from "./custom-style-section"
import { ChatHtmlSettingsSection } from "./chat-html-settings"
import { ChatViewSettingsSection } from "./chat-view-settings-section"

/**
 * 屏幕可用宽度（CSS px），用作聊天宽度滑块上限的依据——主窗口铺满屏幕时聊天列
 * 能达到的最宽值。不用 window.innerWidth：桌面端设置页是独立窗口，量到的是它自己
 * 的宽度。实际显示宽度另由 CSS 按所在列的宽度再封顶（见 chat-content-w）。
 */
function readScreenWidth(): number {
  return typeof window === "undefined" ? 0 : (window.screen?.availWidth ?? 0)
}

type ThemeMode = "system" | "light" | "dark"

export function AppearanceSettings() {
  const t = useTranslations("AppearanceSettings")
  const tShell = useTranslations("SettingsShell")
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { themeColor, setThemeColor } = useThemeColor()
  const { zoomLevel, setZoomLevel } = useZoomLevel()
  const { showWelcomeQuickActions, setShowWelcomeQuickActions } =
    useWelcomeQuickActions()
  const { chatAnimations, setChatAnimations } = useChatAnimationsSetting()
  const { chatContentWidth, setChatContentWidth } = useChatContentWidth()
  const [screenWidth] = useState(readScreenWidth)
  // 宽度以 100% 缩放下的 px 计（随缩放一起放大），所以同一块屏幕在高缩放下能放下
  // 的宽度更小。
  const chatWidthMax = chatContentWidthCeiling(screenWidth, zoomLevel / 100)

  const resolvedThemeLabel =
    resolvedTheme === "dark"
      ? t("resolvedTheme.dark")
      : resolvedTheme === "light"
        ? t("resolvedTheme.light")
        : t("resolvedTheme.unknown")

  return (
    <ScrollArea className="h-full">
      <div className={cn(SETTINGS_FORM_WIDTH, "space-y-4 p-3 md:p-4")}>
        <SettingsPageHeader
          title={tShell("nav.appearance")}
          description={t("pageDescription")}
        />

        <SettingsGroup label={t("groups.theme")}>
          {/* ===== Theme Mode ===== */}
          <SettingsSection
            icon={Sun}
            title={t("sectionTitle")}
            description={
              <>
                {t("sectionDescription")}
                {/* Only worth a line when it isn't what the picker says: under
                  "follow system" the picker can't tell you which one won. */}
                {theme === "system" ? (
                  <span className="mt-1 block" suppressHydrationWarning>
                    {t("currentTheme", { theme: resolvedThemeLabel })}
                  </span>
                ) : null}
              </>
            }
            htmlFor="appearance-theme-mode"
            control={
              <Select
                value={theme ?? "system"}
                onValueChange={(value) => {
                  setTheme(value as ThemeMode)
                  if (
                    typeof window !== "undefined" &&
                    "__TAURI_INTERNALS__" in window
                  ) {
                    import("@/lib/tauri").then((t) =>
                      t.updateAppearanceMode(value).catch(() => {})
                    )
                  }
                }}
              >
                <SelectTrigger
                  id="appearance-theme-mode"
                  size="sm"
                  className="w-40 bg-background text-xs"
                >
                  <SelectValue placeholder={t("placeholder")} />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="system">
                    <span className="inline-flex items-center gap-2">
                      <Monitor className="h-3.5 w-3.5" />
                      {t("system")}
                    </span>
                  </SelectItem>
                  <SelectItem value="light">
                    <span className="inline-flex items-center gap-2">
                      <Sun className="h-3.5 w-3.5" />
                      {t("light")}
                    </span>
                  </SelectItem>
                  <SelectItem value="dark">
                    <span className="inline-flex items-center gap-2">
                      <Moon className="h-3.5 w-3.5" />
                      {t("dark")}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            }
          />

          {/* ===== Theme Color ===== */}
          <SettingsSection
            title={
              <span className="flex items-center gap-2">
                <span
                  className="size-4 rounded-full border"
                  style={{ backgroundColor: THEME_COLOR_PREVIEW[themeColor] }}
                  aria-hidden
                />
                {t("themeColor.sectionTitle")}
              </span>
            }
            description={t("themeColor.sectionDescription")}
          >
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {THEME_COLORS.map((color) => {
                const isActive = themeColor === color
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setThemeColor(color as ThemeColor)}
                    aria-pressed={isActive}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      isActive && "border-primary ring-2 ring-primary/30"
                    )}
                  >
                    <span
                      className="size-4 shrink-0 rounded-full border"
                      style={{ backgroundColor: THEME_COLOR_PREVIEW[color] }}
                      aria-hidden
                    />
                    <span className="truncate">
                      {t(`themeColor.options.${color}`)}
                    </span>
                  </button>
                )
              })}
            </div>
          </SettingsSection>

          {/* ===== Custom style (token overrides + free-form CSS) ===== */}
          <CustomStyleSection />
        </SettingsGroup>

        <SettingsGroup label={t("groups.display")}>
          {/* ===== Zoom Level ===== */}
          <SettingsSection
            icon={Type}
            title={t("zoomLevel.sectionTitle")}
            description={t("zoomLevel.sectionDescription")}
            htmlFor="appearance-zoom-level"
            control={
              <Select
                value={String(zoomLevel)}
                onValueChange={(value) =>
                  setZoomLevel(parseInt(value, 10) as ZoomLevel)
                }
              >
                <SelectTrigger
                  id="appearance-zoom-level"
                  size="sm"
                  className="w-40 bg-background text-xs"
                >
                  <SelectValue placeholder={t("zoomLevel.placeholder")} />
                </SelectTrigger>
                <SelectContent align="end">
                  {ZOOM_LEVELS.map((z) => (
                    <SelectItem key={z} value={String(z)}>
                      {z}%
                      {z === DEFAULT_ZOOM_LEVEL
                        ? ` (${t("zoomLevel.default")})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          {/* ===== Fonts ===== */}
          <FontSettingsSection />

          {/* ===== Workspace background ===== */}
          <WorkspaceBackgroundSection />
        </SettingsGroup>

        <SettingsGroup label={t("groups.conversation")}>
          {/* ===== New conversation — mode selection area ===== */}
          <SettingsSection
            icon={LayoutGrid}
            title={t("welcomePanel.sectionTitle")}
            description={t("welcomePanel.sectionDescription")}
            htmlFor="appearance-welcome-quick-actions"
            control={
              <Switch
                id="appearance-welcome-quick-actions"
                checked={showWelcomeQuickActions}
                onCheckedChange={setShowWelcomeQuickActions}
              />
            }
          />

          {/* ===== Chat view (keh4l: T3-style compact / timeline) ===== */}
          <ChatViewSettingsSection />

          {/* ===== Chat animations ===== */}
          <SettingsSection
            icon={Sparkles}
            title={t("chatAnimations.sectionTitle")}
            description={t("chatAnimations.sectionDescription")}
            htmlFor="appearance-chat-animations"
            control={
              <Switch
                id="appearance-chat-animations"
                checked={chatAnimations}
                onCheckedChange={setChatAnimations}
              />
            }
          />

          <ChatHtmlSettingsSection />

          {/* ===== Chat content width ===== */}
          <SettingsSection
            icon={MoveHorizontal}
            title={t("chatWidth.sectionTitle")}
            description={t("chatWidth.sectionDescription")}
            control={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={chatContentWidth === null}
                onClick={() => setChatContentWidth(null)}
              >
                {t("chatWidth.reset")}
              </Button>
            }
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {t("chatWidth.label")}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {chatContentWidth === null
                    ? t("chatWidth.default", { width: CHAT_CONTENT_DEFAULT })
                    : `${chatContentWidth}px`}
                </span>
              </div>
              <Slider
                value={[
                  Math.min(
                    chatContentWidth ?? CHAT_CONTENT_DEFAULT,
                    chatWidthMax
                  ),
                ]}
                min={CHAT_CONTENT_MIN}
                max={chatWidthMax}
                step={8}
                onValueChange={([v]) => setChatContentWidth(v)}
                aria-label={t("chatWidth.label")}
              />
              <p className="text-2xs text-muted-foreground leading-4">
                {t("chatWidth.hint")}
              </p>
            </div>
          </SettingsSection>
        </SettingsGroup>

        {/* ===== Desktop Pet ===== */}
        <PetManagerSection />
      </div>
    </ScrollArea>
  )
}
