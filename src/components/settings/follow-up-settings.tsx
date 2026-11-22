"use client"

/**
 * keh4l build: what the send key does while the agent is replying — steer
 * into the running turn (default, as in T3 Code) or queue for after it. Per
 * device (`@/lib/follow-up/prefs`); the other one is always a ⌘/Ctrl away.
 */

import { useTranslations } from "next-intl"
import { Forward, ListPlus, MessageSquareReply } from "lucide-react"

import { SettingsSection } from "@/components/shared/settings-section"
import { usePlatform } from "@/hooks/use-platform"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { isFollowUpBehavior } from "@/lib/follow-up/dispatch-mode"
import {
  saveFollowUpBehavior,
  useFollowUpBehavior,
} from "@/lib/follow-up/prefs"

export function FollowUpSettingsSection() {
  const t = useTranslations("FollowUpSettings")
  const behavior = useFollowUpBehavior()
  const { isMac } = usePlatform()
  return (
    <SettingsSection
      icon={MessageSquareReply}
      title={t("title")}
      description={t("description", { mod: isMac ? "⌘" : "Ctrl" })}
      htmlFor="follow-up-behavior"
      control={
        <Select
          value={behavior}
          onValueChange={(value) => {
            if (isFollowUpBehavior(value)) saveFollowUpBehavior(value)
          }}
        >
          <SelectTrigger
            id="follow-up-behavior"
            size="sm"
            className="w-32 bg-background text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="steer">
              <span className="inline-flex items-center gap-2">
                <Forward className="h-3.5 w-3.5" />
                {t("steer")}
              </span>
            </SelectItem>
            <SelectItem value="queue">
              <span className="inline-flex items-center gap-2">
                <ListPlus className="h-3.5 w-3.5" />
                {t("queue")}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </SettingsSection>
  )
}
