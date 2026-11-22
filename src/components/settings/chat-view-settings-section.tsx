"use client"

import { Eye, Gauge, Layers, Map as MapIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { SettingsSection } from "@/components/shared/settings-section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  TOOL_CALL_VISIBILITIES,
  useChatViewPrefs,
  writeChatViewPrefs,
  type ChatView,
  type ToolCallVisibility,
} from "@/lib/chat-view-prefs"

/**
 * keh4l build: Settings → Appearance → Conversation controls for the T3-style
 * compact conversation view, tool-call visibility levels, live speed indicator,
 * and timeline minimap. Stored locally per device (`chat-view-prefs.ts`).
 */
export function ChatViewSettingsSection() {
  const t = useTranslations("AppearanceSettings.chatView")
  const prefs = useChatViewPrefs()
  const isCompact = prefs.view === "compact"

  return (
    <>
      <SettingsSection
        icon={Layers}
        title={t("styleTitle")}
        description={t("styleDescription")}
        htmlFor="appearance-chat-view-style"
        control={
          <Select
            value={prefs.view}
            onValueChange={(value) =>
              writeChatViewPrefs({ view: value as ChatView })
            }
          >
            <SelectTrigger
              id="appearance-chat-view-style"
              size="sm"
              className="w-44 bg-background text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="compact">{t("styleCompact")}</SelectItem>
              <SelectItem value="timeline">{t("styleTimeline")}</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {isCompact ? (
        <>
          <SettingsSection
            icon={Eye}
            title={t("toolVisibilityTitle")}
            description={t("toolVisibilityDescription")}
            htmlFor="appearance-chat-tool-visibility"
            control={
              <Select
                value={prefs.toolVisibility}
                onValueChange={(value) =>
                  writeChatViewPrefs({
                    toolVisibility: value as ToolCallVisibility,
                  })
                }
              >
                <SelectTrigger
                  id="appearance-chat-tool-visibility"
                  size="sm"
                  className="w-44 bg-background text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {TOOL_CALL_VISIBILITIES.map((level) => (
                    <SelectItem key={level} value={level}>
                      {t(`toolVisibility.${level}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          <SettingsSection
            icon={Gauge}
            title={t("liveSpeedTitle")}
            description={t("liveSpeedDescription")}
            htmlFor="appearance-chat-live-speed"
            control={
              <Switch
                id="appearance-chat-live-speed"
                checked={prefs.liveSpeed}
                onCheckedChange={(checked) =>
                  writeChatViewPrefs({ liveSpeed: checked })
                }
              />
            }
          />

          <SettingsSection
            icon={MapIcon}
            title={t("minimapTitle")}
            description={t("minimapDescription")}
            htmlFor="appearance-chat-minimap"
            control={
              <Switch
                id="appearance-chat-minimap"
                checked={prefs.minimap}
                onCheckedChange={(checked) =>
                  writeChatViewPrefs({ minimap: checked })
                }
              />
            }
          />
        </>
      ) : null}
    </>
  )
}
