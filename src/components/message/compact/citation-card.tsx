"use client"

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react"
import { CornerUpLeft, Quote, X } from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import type { CitationItem, ParsedCitationBlock } from "./citation"

export type CitationJumpHandler = (
  citation: Pick<ParsedCitationBlock, "turnIndex" | "fingerprint" | "text">
) => Promise<boolean>

const CitationJumpContext = createContext<CitationJumpHandler | null>(null)

export function CitationJumpProvider({
  onJump,
  children,
}: {
  onJump: CitationJumpHandler | null
  children: ReactNode
}) {
  return (
    <CitationJumpContext.Provider value={onJump}>
      {children}
    </CitationJumpContext.Provider>
  )
}

export function useCitationJump(): CitationJumpHandler | null {
  return useContext(CitationJumpContext)
}

/**
 * Rendered inside a user message bubble for a `codeg-cite:` block. Clicking
 * jumps back to the source turn and highlights the quoted passage for 2s; if
 * the target turn no longer exists, the card stays static and readable.
 */
export const CitationCard = memo(function CitationCard({
  citation,
}: {
  citation: ParsedCitationBlock
}) {
  const t = useTranslations("CompactView")
  const jump = useCitationJump()
  const [missing, setMissing] = useState(false)
  const canJump = citation.turnIndex !== null && jump !== null && !missing

  const handleClick = useCallback(() => {
    if (!canJump || !jump) return
    void jump(citation).then((found) => {
      if (!found) setMissing(true)
    })
  }, [canJump, jump, citation])

  const body = (
    <>
      <Quote
        aria-hidden="true"
        className="mt-0.5 size-3 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">
        {citation.text}
      </span>
      {canJump ? (
        <CornerUpLeft
          aria-hidden="true"
          className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover/cite:opacity-100"
        />
      ) : null}
    </>
  )

  if (!canJump) {
    return (
      <div
        data-compact-cite-card=""
        data-cite-missing={missing ? "true" : undefined}
        className="my-1.5 flex items-start gap-2 rounded-lg border border-foreground/15 bg-background/35 px-2.5 py-1.5 text-start first:mt-0 last:mb-0"
      >
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-compact-cite-card=""
      data-cite-turn={citation.turnIndex ?? undefined}
      onClick={handleClick}
      title={t("citationJumpTitle")}
      aria-label={t("citationJumpAria")}
      className="group/cite my-1.5 flex w-full cursor-pointer items-start gap-2 rounded-lg border border-foreground/15 bg-background/35 px-2.5 py-1.5 text-start transition-colors hover:border-foreground/30 hover:bg-background/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring first:mt-0 last:mb-0"
    >
      {body}
    </button>
  )
})

/**
 * Composer strip showing pending citations before send. Each chip expands to
 * show its full text on click and can be removed individually.
 */
export const ComposerCitationChips = memo(function ComposerCitationChips({
  citations,
  onRemove,
  className,
}: {
  citations: readonly CitationItem[]
  onRemove: (id: string) => void
  className?: string
}) {
  const t = useTranslations("CompactView")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (citations.length === 0) return null

  return (
    <div
      data-compact-composer-cites=""
      className={cn("flex flex-col gap-1.5 px-3 pt-2.5", className)}
    >
      {citations.map((item) => {
        const expanded = expandedId === item.id
        return (
          <div
            key={item.id}
            data-compact-cite-chip=""
            className="flex items-start gap-2 rounded-lg border border-border/80 bg-muted/40 px-2.5 py-1.5 text-xs"
          >
            <Quote
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : item.id)}
              aria-expanded={expanded}
              className="min-w-0 flex-1 cursor-pointer text-start text-foreground/85 hover:text-foreground"
              title={expanded ? t("collapseQuote") : t("expandQuote")}
            >
              <span
                className={cn(
                  "block whitespace-pre-wrap break-words leading-relaxed",
                  !expanded && "line-clamp-1"
                )}
              >
                {item.text}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={t("removeQuote")}
              title={t("removeQuote")}
              className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
})
