// `create_assistant` / `update_assistant`, the codeg-mcp tools the keh4l build
// adds so an agent can set up the user's assistants from a conversation
// (`src-tauri/src/assistant_tools`). Kept free of imports so the tool-name
// normalizer can use it without an import cycle.

export const CREATE_ASSISTANT_TOOL = "create_assistant"
export const UPDATE_ASSISTANT_TOOL = "update_assistant"

export const ASSISTANT_TOOL_NAMES: ReadonlySet<string> = new Set([
  CREATE_ASSISTANT_TOOL,
  UPDATE_ASSISTANT_TOOL,
])

const ASSISTANT_TOOL_SUFFIX_RE =
  /(?:^|[^a-z0-9])(create_assistant|update_assistant)$/

/** The canonical name for any host's spelling of these tools (bare,
 *  `mcp__<server>__<tool>`, `<server>/<tool>`, …), or null. Expects a
 *  lowercased name. */
export function assistantToolCanonicalName(name: string): string | null {
  return name.match(ASSISTANT_TOOL_SUFFIX_RE)?.[1] ?? null
}

/**
 * The assistant a successful call saved, read off its reply: the backend
 * writes `assistant_id=N` into every success (`assistant_tools/mcp.rs`), and
 * only the text survives on every host. `null` for a refusal ("Not created:
 * …", which may name OTHER assistants' ids) and while the call runs.
 */
export function assistantIdFromResult(
  text: string | null | undefined
): number | null {
  if (!text) return null
  const trimmed = text.trimStart()
  if (!/^(Created|Updated) assistant /.test(trimmed)) return null
  const match = trimmed.match(/\(assistant_id=(\d+)\)/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
