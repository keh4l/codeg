"use client"

/**
 * keh4l build: the "wake the parent agent when a delegation finishes" switch,
 * on the multi-agent settings' General card. Saved the moment it flips — it
 * has its own endpoint, outside the card's save bar — and kept in step with a
 * flip made on another client.
 */

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { CornerDownLeft } from "lucide-react"
import { toast } from "sonner"

import { SettingRow } from "@/components/shared/setting-card"
import { Switch } from "@/components/ui/switch"
import { toErrorMessage } from "@/lib/app-error"
import {
  DELEGATION_PUSH_SETTINGS_CHANGED_EVENT,
  type DelegationPushSettings,
  getDelegationPushSettings,
  setDelegationPushSettings,
} from "@/lib/delegation-push-api"
import { subscribe } from "@/lib/platform"

export function DelegationPushSettingRow({ disabled }: { disabled: boolean }) {
  const t = useTranslations("AcpAgentSettings.multiAgent")
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let disposed = false
    getDelegationPushSettings()
      .then((s) => {
        if (!disposed) setEnabled(s.enabled)
      })
      .catch(() => {
        // The switch's default; a backend without the endpoint is old.
        if (!disposed) setEnabled(true)
      })
    let unsubscribe: (() => void) | undefined
    void subscribe<DelegationPushSettings>(
      DELEGATION_PUSH_SETTINGS_CHANGED_EVENT,
      (remote) => setEnabled(remote.enabled)
    ).then((fn) => {
      if (disposed) fn()
      else unsubscribe = fn
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  const change = async (next: boolean) => {
    const previous = enabled
    setEnabled(next)
    setSaving(true)
    try {
      const saved = await setDelegationPushSettings({ enabled: next })
      setEnabled(saved.enabled)
    } catch (err) {
      setEnabled(previous)
      toast.error(t("pushSaveFailed", { detail: toErrorMessage(err) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingRow
      icon={CornerDownLeft}
      title={t("pushResults")}
      description={t("pushResultsHint")}
      htmlFor="delegation-push-results"
      control={
        <Switch
          id="delegation-push-results"
          checked={enabled ?? true}
          onCheckedChange={(next) => void change(next)}
          disabled={disabled || enabled === null || saving}
        />
      }
    />
  )
}
