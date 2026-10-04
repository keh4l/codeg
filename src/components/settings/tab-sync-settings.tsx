"use client"

/**
 * Whether the open conversation tabs follow every client of the server or stay
 * with each window — the settings-page half of `tab-sync-prefs.ts`. Stored per
 * client and applied live, so there is nothing to load or save here beyond the
 * switch itself.
 */

import { useTranslations } from "next-intl"
import { PanelsTopLeft } from "lucide-react"

import { SettingsSection } from "@/components/shared/settings-section"
import { Switch } from "@/components/ui/switch"
import { saveTabSyncEnabled, useTabSyncEnabled } from "@/lib/tab-sync-prefs"

export function TabSyncSettingsSection() {
  const t = useTranslations("TabSyncSettings")
  const enabled = useTabSyncEnabled()

  return (
    <SettingsSection
      icon={PanelsTopLeft}
      title={t("title")}
      description={t("description")}
      htmlFor="tab-sync-enabled"
      control={
        <Switch
          id="tab-sync-enabled"
          checked={enabled}
          onCheckedChange={saveTabSyncEnabled}
        />
      }
    >
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </SettingsSection>
  )
}
