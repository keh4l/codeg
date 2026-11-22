/**
 * keh4l build: T3-style citations with backlinks.
 *
 * A citation serializes into ordinary Markdown so the agent sees the quoted
 * passage without depending on Codeg:
 *
 *   [Quoted](codeg-cite:<turnIndex>/<fingerprint>)
 *   > line 1
 *   > line 2
 *
 * When rendered in a user bubble, the link + blockquote becomes a clickable
 * citation card that jumps back to the source turn (loading older history if
 * needed) and highlights the passage for two seconds. When the source turn no
 * longer exists (compacted, another device), the card displays the excerpt
 * without jumping.
 */

export interface CitationItem {
  /** Local unique id for composer chip lists. */
  id: string
  /** Global turn index in the conversation's full turn list, or null when
   *  quoting something without a persisted turn index (e.g. unsaved live reply). */
  turnIndex: number | null
  /** Optional turn id for fallback lookup among currently rendered turns. */
  turnId?: string | null
  /** Short content fingerprint used to locate the passage inside the target turn. */
  fingerprint: string
  /** Quoted text (un-prefixed, as selected). */
  text: string
}

export interface ParsedCitationBlock {
  kind: "citation"
  turnIndex: number | null
  fingerprint: string
  text: string
}

export type UserTextOrCitationBlock =
  | { kind: "text"; text: string }
  | ParsedCitationBlock

/** FNV-1a 32-bit hash encoded in base36 — short, stable across platforms,
 *  whitespace-normalized so minor formatting changes still match. */
export function citationFingerprint(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim().slice(0, 240)
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function createCitationItem(
  text: string,
  source: { turnIndex?: number | null; turnId?: string | null } = {}
): CitationItem | null {
  const cleaned = text.replace(/\r\n?/g, "\n").trim()
  if (!cleaned) return null
  const fp = citationFingerprint(cleaned)
  return {
    id: `${source.turnIndex ?? "x"}-${fp}-${Math.random().toString(36).slice(2, 7)}`,
    turnIndex:
      typeof source.turnIndex === "number" && source.turnIndex >= 0
        ? source.turnIndex
        : null,
    turnId: source.turnId ?? null,
    fingerprint: fp,
    text: cleaned,
  }
}

/**
 * Serialize one citation to plain Markdown (`[label](codeg-cite:...)` + `> …`).
 */
export function serializeCitation(
  item: Pick<CitationItem, "turnIndex" | "fingerprint" | "text">,
  label = "引用"
): string {
  const turnPart = item.turnIndex !== null ? String(item.turnIndex) : "_"
  const safeLabel = label.replace(/[\[\]]/g, "")
  const quotedLines = item.text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n")
  return `[${safeLabel}](codeg-cite:${turnPart}/${item.fingerprint})\n${quotedLines}`
}

/** Serialize multiple citations ahead of user body text. */
export function prependCitationsToText(
  citations: readonly CitationItem[],
  body: string,
  label = "引用"
): string {
  if (citations.length === 0) return body
  const prefix = citations.map((c) => serializeCitation(c, label)).join("\n\n")
  const trimmedBody = body.trimStart()
  return trimmedBody ? `${prefix}\n\n${body}` : prefix
}

const CITE_HEADER_RE = /^\[[^\]]+\]\(codeg-cite:(\d+|_)\/([a-z0-9]+)\)\s*$/i

/**
 * Split a user message's raw text into plain text segments and `codeg-cite:`
 * citation blocks. Ordinary `> ` quotes without a `codeg-cite:` header stay
 * untouched in `{ kind: "text" }` blocks so upstream quote rendering works.
 */
export function parseUserMessageCitations(
  text: string
): UserTextOrCitationBlock[] {
  if (!text.includes("codeg-cite:")) {
    return text ? [{ kind: "text", text }] : []
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const blocks: UserTextOrCitationBlock[] = []
  let plain: string[] = []

  const flushPlain = () => {
    if (plain.length === 0) return
    const joined = plain.join("\n")
    if (joined.trim().length > 0) {
      blocks.push({ kind: "text", text: joined.replace(/^\n+|\n+$/g, "") })
    }
    plain = []
  }

  let i = 0
  while (i < lines.length) {
    const match = CITE_HEADER_RE.exec(lines[i]!)
    if (match && i + 1 < lines.length && /^>\s?/.test(lines[i + 1]!)) {
      flushPlain()
      const rawTurn = match[1]!
      const turnIndex = rawTurn === "_" ? null : Number.parseInt(rawTurn, 10)
      const fingerprint = match[2]!
      i += 1
      const quoted: string[] = []
      while (i < lines.length && /^>/.test(lines[i]!)) {
        quoted.push(lines[i]!.replace(/^>\s?/, ""))
        i += 1
      }
      blocks.push({
        kind: "citation",
        turnIndex: Number.isNaN(turnIndex) ? null : turnIndex,
        fingerprint,
        text: quoted.join("\n").trim(),
      })
      // Skip one trailing blank separator line after a citation block.
      if (i < lines.length && lines[i]!.trim() === "") {
        i += 1
      }
      continue
    }
    plain.push(lines[i]!)
    i += 1
  }
  flushPlain()
  return blocks
}

/** Whether a string contains at least one valid `codeg-cite:` block. */
export function hasUserMessageCitations(text: string): boolean {
  return (
    text.includes("codeg-cite:") &&
    parseUserMessageCitations(text).some((b) => b.kind === "citation")
  )
}
