"use client"

import { CodeXml } from "lucide-react"
import { useTranslations } from "next-intl"
import { Switch } from "@/components/ui/switch"
import { SettingsSection } from "@/components/shared/settings-section"
import { saveChatHtmlEnabled, useChatHtmlEnabled } from "@/lib/chat-html-prefs"

export function ChatHtmlSettingsSection() {
  const t = useTranslations("HtmlCodePreview")
  const enabled = useChatHtmlEnabled()
  return (
    <SettingsSection
      icon={CodeXml}
      title={t("settingsTitle")}
      description={t("settingsDescription")}
      htmlFor="chat-html-enabled"
      control={
        <Switch
          id="chat-html-enabled"
          checked={enabled}
          onCheckedChange={saveChatHtmlEnabled}
        />
      }
    />
  )
}
