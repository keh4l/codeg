// keh4l build: "wake the parent agent when a delegation finishes"
// (`src-tauri/src/acp/delegation/delivery.rs`). Server-side, so every client
// of one server sees the same switch; it applies to sessions launched after a
// change.

import { getTransport } from "@/lib/transport"

/** Broadcast after the switch changes, carrying {@link DelegationPushSettings}. */
export const DELEGATION_PUSH_SETTINGS_CHANGED_EVENT =
  "delegation-push-settings://changed"

export interface DelegationPushSettings {
  enabled: boolean
}

export async function getDelegationPushSettings(): Promise<DelegationPushSettings> {
  return getTransport().call("get_delegation_push_settings")
}

export async function setDelegationPushSettings(
  settings: DelegationPushSettings
): Promise<DelegationPushSettings> {
  return getTransport().call("set_delegation_push_settings", { settings })
}
