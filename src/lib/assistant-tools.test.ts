// keh4l build: the names and reply parsing of `create_assistant` /
// `update_assistant`, and how every host's spelling of them reaches their card.
import { describe, expect, it } from "vitest"

import {
  assistantIdFromResult,
  assistantToolCanonicalName,
} from "@/lib/assistant-tools"
import { isAgentLikeToolName } from "@/lib/adapters/tool-kind-classifier"
import { parseCodegMcpToolCall } from "@/lib/codeg-mcp-tool"
import {
  inferLiveToolName,
  normalizeToolName,
} from "@/lib/tool-call-normalization"

describe("assistant tool names", () => {
  it("collapses every host spelling onto the canonical name", () => {
    for (const name of [
      "create_assistant",
      "mcp__codeg-mcp__create_assistant",
      "codeg-mcp/create_assistant",
      "codeg-mcp.create_assistant",
    ]) {
      expect(assistantToolCanonicalName(name)).toBe("create_assistant")
      expect(normalizeToolName(name)).toBe("create_assistant")
    }
    expect(normalizeToolName("mcp__codeg-mcp__update_assistant")).toBe(
      "update_assistant"
    )
    expect(assistantToolCanonicalName("recreate_assistant")).toBeNull()
  })

  it("wins over the input shape while the call streams", () => {
    const rawInput = JSON.stringify({
      name: "Reviewer",
      agent_type: "codex",
      instructions: "Review the diff.",
    })
    expect(
      inferLiveToolName({
        title: "mcp__codeg-mcp__create_assistant",
        rawInput,
      })
    ).toBe("create_assistant")
    expect(
      inferLiveToolName({
        title: "Update assistant",
        rawInput,
        meta: { claudeCode: { toolName: "mcp__codeg-mcp__update_assistant" } },
      })
    ).toBe("update_assistant")
  })

  it("is a workbench tool, so its card shows while it has no arguments", () => {
    expect(isAgentLikeToolName("create_assistant")).toBe(true)
    expect(isAgentLikeToolName("mcp__codeg-mcp__update_assistant")).toBe(true)
  })
})

describe("assistantIdFromResult", () => {
  it("reads the saved assistant off a success", () => {
    expect(
      assistantIdFromResult(
        'Created assistant "Reviewer" (assistant_id=7), running on Codex CLI.\nSet as asked: Model: GPT-5.5'
      )
    ).toBe(7)
    expect(
      assistantIdFromResult(
        'Updated assistant "Reviewer" (assistant_id=12): changed instructions.'
      )
    ).toBe(12)
  })

  it("never takes an id from a refusal, which may name other assistants", () => {
    expect(
      assistantIdFromResult(
        'Not created: an assistant named "Reviewer" already exists (assistant_id=7).'
      )
    ).toBeNull()
    expect(assistantIdFromResult("")).toBeNull()
    expect(assistantIdFromResult(null)).toBeNull()
  })
})

describe("the row's detail", () => {
  it("names the assistant an update targets, by link, id or name", () => {
    const detail = (args: Record<string, unknown>) =>
      parseCodegMcpToolCall({
        tool: "update_assistant",
        input: JSON.stringify(args),
        state: "input-available",
      }).detail
    expect(detail({ assistant: "codeg://assistant/7" })).toBe("#7")
    expect(detail({ assistant: 7 })).toBe("#7")
    expect(detail({ assistant: "@Reviewer" })).toBe("Reviewer")
    expect(detail({ assistant: 7, name: "Critic" })).toBe("Critic")
    expect(
      parseCodegMcpToolCall({
        tool: "create_assistant",
        input: JSON.stringify({ name: "Reviewer", agent_type: "codex" }),
        state: "input-available",
      }).detail
    ).toBe("Reviewer")
  })
})
