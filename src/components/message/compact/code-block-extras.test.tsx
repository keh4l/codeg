import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"

import enMessages from "@/i18n/messages/en.json"
import {
  CodeBlockEnhancer,
  formatTerminalPasteCommand,
  isShellFenceLanguage,
  languageFromClassName,
} from "./code-block-extras"

const h = vi.hoisted(() => ({
  pasteCommandInNewTerminal: vi.fn(async () => "term-1"),
}))

vi.mock("@/contexts/terminal-context", () => ({
  useOptionalTerminalContext: () => ({
    pasteCommandInNewTerminal: h.pasteCommandInNewTerminal,
  }),
}))

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe("code block helpers", () => {
  it("parses language and detects shell fences", () => {
    expect(languageFromClassName("foo language-bash bar")).toBe("bash")
    expect(isShellFenceLanguage("bash")).toBe(true)
    expect(isShellFenceLanguage("powershell")).toBe(true)
    expect(isShellFenceLanguage("typescript")).toBe(false)
  })

  it("formats commands for paste-without-execute safely", () => {
    expect(formatTerminalPasteCommand("pnpm test\n", "bash")).toBe("pnpm test")
    expect(
      formatTerminalPasteCommand("# install\npnpm add zod\npnpm test\n", "sh")
    ).toBe("pnpm add zod && pnpm test")
    expect(
      formatTerminalPasteCommand("$ git status\n$ git diff\n", "console")
    ).toBe("git status && git diff")
    expect(formatTerminalPasteCommand("echo foo \\\n  bar", "bash")).toBe(
      "echo foo bar"
    )
  })
})

describe("CodeBlockEnhancer", () => {
  it("toggles wrap mode and pastes shell command to terminal without executing", async () => {
    const user = userEvent.setup()
    h.pasteCommandInNewTerminal.mockClear()

    const { container } = render(
      wrap(
        <CodeBlockEnhancer language="bash" code="pnpm test">
          <div data-streamdown="code-block">
            <div data-streamdown="code-block-header">
              <span>bash</span>
            </div>
            <div data-streamdown="code-block-actions" />
            <div data-streamdown="code-block-body">
              <pre>
                <code>pnpm test</code>
              </pre>
            </div>
          </div>
        </CodeBlockEnhancer>
      )
    )

    const wrapBtn = screen.getByRole("button", { name: /wrap lines/i })
    expect(container.querySelector('[data-code-wrap="on"]')).toBeNull()
    await user.click(wrapBtn)
    expect(container.querySelector('[data-code-wrap="on"]')).not.toBeNull()

    const runBtn = screen.getByRole("button", { name: /run in terminal/i })
    await user.click(runBtn)
    expect(h.pasteCommandInNewTerminal).toHaveBeenCalledWith("pnpm test")
  })

  it("omits Run in terminal for non-shell languages", () => {
    render(
      wrap(
        <CodeBlockEnhancer language="typescript" code="const x = 1">
          <div data-streamdown="code-block">
            <div data-streamdown="code-block-actions" />
          </div>
        </CodeBlockEnhancer>
      )
    )

    expect(screen.getByRole("button", { name: /wrap lines/i })).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /run in terminal/i })
    ).toBeNull()
  })
})
