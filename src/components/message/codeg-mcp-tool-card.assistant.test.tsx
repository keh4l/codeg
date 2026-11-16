// keh4l build: a `create_assistant` / `update_assistant` call's card draws the
// assistant it saved, live from the store, with the editor one click away.
import { type ReactElement } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => (
    <div data-testid="markdown-response">{children}</div>
  ),
}))
// The real editor probes the agent when it opens; the card only has to open it
// on the right assistant.
vi.mock("@/components/settings/assistant-editor-dialog", () => ({
  AssistantEditorDialog: ({
    open,
    assistant,
  }: {
    open: boolean
    assistant: { name: string } | null
  }) =>
    open ? <div data-testid="assistant-editor">{assistant?.name}</div> : null,
}))

import { CodegMcpToolCard } from "./codeg-mcp-tool-card"
import enMessages from "@/i18n/messages/en.json"
import type { AssistantInfo } from "@/lib/types"
import {
  resetAssistantsStore,
  useAssistantsStore,
} from "@/stores/assistants-store"

const t = enMessages.Folder.chat.codegMcpTool

function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

function reply(text: string, isError = false): string {
  return JSON.stringify({ content: [{ type: "text", text }], isError })
}

const REVIEWER: AssistantInfo = {
  id: 7,
  uid: "a7",
  name: "Reviewer",
  description: "Reviews diffs",
  avatar: { kind: "emoji", emoji: "🦉", color: "amber" },
  agent_type: "codex",
  agent_options: {
    mode_id: null,
    config_values: {
      model: "gpt-5.5",
      reasoning_effort: "high",
      fast: "false",
    },
  },
  label_snapshot: {
    agent: "Codex CLI",
    mode: null,
    options: [
      { id: "model", kind: "select", name: "Model", value_label: "GPT-5.5" },
      {
        id: "reasoning_effort",
        kind: "select",
        name: "Reasoning Effort",
        value_label: "High",
      },
      { id: "fast", kind: "boolean", name: "Fast mode", value_label: "Off" },
    ],
  },
  instructions: "Lead with the verdict.",
  enabled: true,
  sort_order: 1,
  revision: 1,
  created_at: "2026-11-16T00:00:00Z",
  updated_at: "2026-11-16T00:00:00Z",
  deleted_at: null,
}

const CREATED = reply(
  'Created assistant "Reviewer" (assistant_id=7), running on Codex CLI.\nSet as asked: Model: GPT-5.5'
)

beforeEach(() => {
  resetAssistantsStore()
})

describe("the assistant tools' card", () => {
  it("names the assistant and, opened, shows it as saved", () => {
    useAssistantsStore.getState().merge([REVIEWER])
    renderWithIntl(
      <CodegMcpToolCard
        tool="create_assistant"
        input={JSON.stringify({ name: "Reviewer", agent_type: "codex" })}
        output={CREATED}
        state="output-available"
      />
    )
    const row = screen.getByRole("button", {
      name: new RegExp(t.createAssistant.replace("{name}", "Reviewer")),
    })
    fireEvent.click(row)
    expect(screen.getByTestId("assistant-tool-summary")).toBeInTheDocument()
    expect(screen.getByText("Reviews diffs")).toBeInTheDocument()
    expect(screen.getByText("GPT-5.5")).toBeInTheDocument()
    expect(screen.getByText("Lead with the verdict.")).toBeInTheDocument()
    // A switch reads in the reader's words, not the stored label.
    expect(
      screen.getByText(enMessages.AcpAgentSettings.multiAgent.booleanOff)
    ).toBeInTheDocument()
    // The reply, written for the model, gives way to the assistant.
    expect(screen.queryByTestId("markdown-response")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: t.assistant.edit }))
    expect(screen.getByTestId("assistant-editor")).toHaveTextContent("Reviewer")
  })

  it("follows a rename made since, in the row too", () => {
    useAssistantsStore.getState().merge([REVIEWER])
    renderWithIntl(
      <CodegMcpToolCard
        tool="update_assistant"
        input={JSON.stringify({ assistant: 7, instructions: "x" })}
        output={reply(
          'Updated assistant "Reviewer" (assistant_id=7): changed instructions.'
        )}
        state="output-available"
      />
    )
    expect(
      screen.getByText(t.updateAssistant.replace("{name}", "Reviewer"))
    ).toBeInTheDocument()
    act(() =>
      useAssistantsStore
        .getState()
        .merge([{ ...REVIEWER, name: "Critic", revision: 2 }])
    )
    expect(
      screen.getByText(t.updateAssistant.replace("{name}", "Critic"))
    ).toBeInTheDocument()
  })

  it("keeps the reply for a refusal, and for an assistant it never saw", () => {
    renderWithIntl(
      <CodegMcpToolCard
        tool="create_assistant"
        input={JSON.stringify({ name: "Reviewer", agent_type: "codex" })}
        output={reply(
          'Not created: an assistant named "Reviewer" already exists (assistant_id=7).',
          true
        )}
        state="output-error"
        errorText='Not created: an assistant named "Reviewer" already exists (assistant_id=7).'
      />
    )
    fireEvent.click(screen.getByRole("button"))
    expect(screen.queryByTestId("assistant-tool-summary")).toBeNull()
    expect(screen.getByText(/already exists/)).toBeInTheDocument()
  })

  it("says so when the assistant has been deleted since", () => {
    useAssistantsStore
      .getState()
      .merge([{ ...REVIEWER, deleted_at: "2026-11-16T01:00:00Z", revision: 3 }])
    renderWithIntl(
      <CodegMcpToolCard
        tool="create_assistant"
        input={JSON.stringify({ name: "Reviewer", agent_type: "codex" })}
        output={CREATED}
        state="output-available"
      />
    )
    fireEvent.click(screen.getByRole("button"))
    expect(
      screen.getByText(t.assistant.deleted.replace("{name}", "Reviewer"))
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: t.assistant.edit })
    ).not.toBeInTheDocument()
  })
})
