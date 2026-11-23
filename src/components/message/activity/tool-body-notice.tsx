"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ScissorsIcon } from "lucide-react"

import type { ToolPartBodyRefs } from "@/lib/adapters/ai-elements-adapter"
import { formatBytes } from "@/lib/harness/display"
import { loadToolBodies, useToolBodyState } from "@/lib/tool-bodies"

interface Scope {
  stepKey: string
  refs: ToolPartBodyRefs
}

const ToolBodyScopeContext = createContext<Scope | null>(null)

/**
 * The shortened bodies of the tool step rendered inside (fork,
 * `lib/tool-bodies.ts`), for its row's {@link ToolBodyNotice}. Always the
 * same element whatever `refs` is, so the row underneath keeps its state
 * when the full text arrives and the references go.
 */
export function ToolBodyScope({
  stepKey,
  refs,
  children,
}: {
  stepKey: string
  refs: ToolPartBodyRefs | undefined
  children: ReactNode
}) {
  const value = useMemo(
    () => (refs && (refs.input || refs.output) ? { stepKey, refs } : null),
    [stepKey, refs]
  )
  return (
    <ToolBodyScopeContext.Provider value={value}>
      {children}
    </ToolBodyScopeContext.Provider>
  )
}

/**
 * Under an open row whose input or output the server shortened: says so, and
 * loads the full text when asked. Nothing for any other row (a row nested in
 * the step's panel has a key of its own).
 */
export function ToolBodyNotice({ stepKey }: { stepKey: string }) {
  const scope = useContext(ToolBodyScopeContext)
  const refs = scope?.stepKey === stepKey ? scope.refs : undefined
  const input = useToolBodyState(refs?.input)
  const output = useToolBodyState(refs?.output)
  const t = useTranslations("Folder.chat.activity.shortened")
  const locale = useLocale()
  if (!refs) return null
  const states = [refs.input ? input : null, refs.output ? output : null]
  const loading = states.some((state) => state?.status === "loading")
  const failed = !loading && states.some((state) => state?.status === "failed")
  const bytes = (refs.input?.bytes ?? 0) + (refs.output?.bytes ?? 0)
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
      data-testid="tool-body-notice"
    >
      <ScissorsIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>
        {failed
          ? t("failed")
          : loading
            ? t("loading")
            : t("note", { size: formatBytes(bytes, locale) })}
      </span>
      {loading ? null : (
        <button
          type="button"
          className="cursor-pointer rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => loadToolBodies(refs)}
        >
          {failed ? t("retry") : t("load")}
        </button>
      )}
    </div>
  )
}
