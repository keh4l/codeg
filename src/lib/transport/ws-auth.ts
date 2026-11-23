export const CODEG_WS_PROTOCOL = "codeg-events"
// Fork: protocol v2 (compressed, split frames — `ws-frame-decoder.ts`). MUST
// match `WS_EVENT_PROTOCOL_V2` in `src-tauri/src/web/ws_frame.rs`. Offered
// before v1; a server that does not know it selects v1.
export const CODEG_WS_PROTOCOL_V2 = "codeg-events.v2"
const CODEG_WS_TOKEN_PROTOCOL_PREFIX = "codeg-token."

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function buildCodegWebSocketProtocols(
  token: string,
  options: { v2?: boolean } = {}
): string[] {
  const events = options.v2
    ? [CODEG_WS_PROTOCOL_V2, CODEG_WS_PROTOCOL]
    : [CODEG_WS_PROTOCOL]
  const trimmed = token.trim()
  if (!trimmed) return events
  return [
    ...events,
    `${CODEG_WS_TOKEN_PROTOCOL_PREFIX}${base64UrlEncode(trimmed)}`,
  ]
}
