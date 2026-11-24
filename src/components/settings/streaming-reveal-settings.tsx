"use client"

// keh4l build: the Appearance setting for paced streaming text
// (`lib/streaming/reveal-setting.ts`).

import { Waves } from "lucide-react"
import { useTranslations } from "next-intl"

import { SettingsSection } from "@/components/shared/settings-section"
import { Switch } from "@/components/ui/switch"
import {
  useStreamingReveal,
  writeStreamingReveal,
} from "@/lib/streaming/reveal-setting"

export function StreamingRevealSettingsSection() {
  const t = useTranslations("AppearanceSettings.streamingReveal")
  const reveal = useStreamingReveal()
  return (
    <SettingsSection
      icon={Waves}
      title={t("sectionTitle")}
      description={t("sectionDescription")}
      htmlFor="appearance-streaming-reveal"
      control={
        <Switch
          id="appearance-streaming-reveal"
          checked={reveal === "auto"}
          onCheckedChange={(on) =>
            writeStreamingReveal(on ? "auto" : "instant")
          }
        />
      }
    />
  )
}
