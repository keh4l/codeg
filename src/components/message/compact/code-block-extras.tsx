"use client"

import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { Terminal, WrapText } from "lucide-react"
import { useMessages } from "next-intl"
import { toast } from "sonner"

import { useOptionalTerminalContext } from "@/contexts/terminal-context"
import { cn } from "@/lib/utils"

const FALLBACK_LABELS = {
  codeWrap: "Wrap lines",
  codeUnwrap: "Unwrap lines",
  runInTerminal: "Run in terminal",
  runInTerminalHint: "Paste command into a new terminal (press Enter to run)",
  pastedToTerminal: "Pasted command into new terminal — press Enter to run",
} as const

type CodeBlockLabelKey = keyof typeof FALLBACK_LABELS

/**
 * `MessageResponse` is also rendered in isolated contexts without
 * `NextIntlClientProvider`; read `CompactView` messages when present and fall
 * back to English defaults otherwise. `useMessages()` calls a single
 * `useContext` before throwing, so hook order stays identical either way.
 */
function useOptionalCompactLabel(): (key: CodeBlockLabelKey) => string {
  let messages: Record<string, unknown> | null = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- called unconditionally as the first hook; useMessages only invokes useContext before throwing when NextIntlClientProvider is absent
    messages = useMessages() as Record<string, unknown>
  } catch {
    messages = null
  }
  const ns =
    messages &&
    typeof messages.CompactView === "object" &&
    messages.CompactView !== null
      ? (messages.CompactView as Record<string, unknown>)
      : null
  return useCallback(
    (key: CodeBlockLabelKey) => {
      const value = ns?.[key]
      return typeof value === "string" ? value : FALLBACK_LABELS[key]
    },
    [ns]
  )
}

const SHELL_LANGUAGES = new Set([
  "sh",
  "bash",
  "zsh",
  "shell",
  "console",
  "powershell",
  "ps1",
  "pwsh",
  "fish",
  "shellsession",
])

/** Extract the fence language from a Streamdown code element's `className`. */
export function languageFromClassName(className: string | undefined): string {
  if (!className) return ""
  const match = /(?:^|\s)language-([^\s]+)/i.exec(className)
  return match ? match[1]!.toLowerCase() : ""
}

export function isShellFenceLanguage(lang: string): boolean {
  return SHELL_LANGUAGES.has(lang.toLowerCase())
}

/**
 * Prepare a fenced shell block to be pasted into a terminal WITHOUT executing
 * any line prematurely:
 * - For `console` / `shellsession` fences, strip leading `$ ` prompts when all
 *   command lines carry them.
 * - Drop empty / comment-only lines.
 * - Collapse shell line continuations (`\\\n`).
 * - Keep a single command verbatim; join multiple lines with ` && ` so no bare
 *   newline fires inside the PTY before the user hits Enter.
 */
export function formatTerminalPasteCommand(code: string, lang: string): string {
  let text = code.replace(/\r\n?/g, "\n").trim()
  if (!text) return ""
  // Collapse explicit backslash line continuations.
  text = text.replace(/[ \t]*\\\n[ \t]*/g, " ")
  let lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
  if (lines.length === 0) return ""
  const lower = lang.toLowerCase()
  if (
    (lower === "console" || lower === "shellsession") &&
    lines.every((l) => /^\$\s+/.test(l))
  ) {
    lines = lines.map((l) => l.replace(/^\$\s+/, ""))
  }
  return lines.length === 1 ? lines[0]! : lines.join(" && ")
}

/**
 * keh4l build: wraps a Streamdown fenced code block to inject two extra
 * controls into its `[data-streamdown="code-block-actions"]` header bar:
 * 1. Line-wrap toggle (all languages)
 * 2. "Run in terminal" (shell fences only — opens a new terminal in the active
 *    folder and pastes the command WITHOUT executing it; user presses Enter).
 *
 * Works in both compact and timeline chat views.
 */
export const CodeBlockEnhancer = memo(function CodeBlockEnhancer({
  language,
  code,
  filename,
  children,
}: {
  language: string
  code: string
  filename?: string | null
  children: ReactNode
}) {
  const t = useOptionalCompactLabel()
  const terminal = useOptionalTerminalContext()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [actionsTarget, setActionsTarget] = useState<Element | null>(null)
  const [wrapped, setWrapped] = useState(false)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const sync = () => {
      const target = host.querySelector(
        '[data-streamdown="code-block-actions"]'
      )
      setActionsTarget((cur) => (cur === target ? cur : target))
      if (filename) {
        const label = host.querySelector(
          '[data-streamdown="code-block-header"] > span'
        )
        if (label && label.textContent !== filename) {
          label.textContent = filename
        }
      }
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(host, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [filename])

  const shellCommand = isShellFenceLanguage(language)
    ? formatTerminalPasteCommand(code, language)
    : ""
  const canRunInTerminal = Boolean(
    shellCommand && terminal?.pasteCommandInNewTerminal
  )

  const handleRunInTerminal = useCallback(() => {
    if (!shellCommand || !terminal) return
    void terminal.pasteCommandInNewTerminal(shellCommand).then((id) => {
      if (id) {
        toast.success(t("pastedToTerminal"))
      }
    })
  }, [shellCommand, terminal, t])

  const controls = (
    <span className="inline-flex items-center gap-1" data-code-extra-actions="">
      <button
        type="button"
        data-code-wrap-toggle=""
        aria-pressed={wrapped}
        aria-label={wrapped ? t("codeUnwrap") : t("codeWrap")}
        title={wrapped ? t("codeUnwrap") : t("codeWrap")}
        onClick={() => setWrapped((v) => !v)}
        className={cn(
          "cursor-pointer p-1 text-muted-foreground transition-colors hover:text-foreground",
          wrapped && "text-foreground"
        )}
      >
        <WrapText aria-hidden="true" className="size-3.5" />
      </button>
      {canRunInTerminal ? (
        <button
          type="button"
          data-code-run-terminal=""
          aria-label={t("runInTerminal")}
          title={t("runInTerminalHint")}
          onClick={handleRunInTerminal}
          className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <Terminal aria-hidden="true" className="size-3.5" />
          <span className="hidden sm:inline">{t("runInTerminal")}</span>
        </button>
      ) : null}
    </span>
  )

  return (
    <div
      ref={hostRef}
      className="code-block-enhanced"
      data-code-wrap={wrapped ? "on" : undefined}
    >
      {children}
      {actionsTarget ? createPortal(controls, actionsTarget) : null}
    </div>
  )
})
