/**
 * A live call whose bodies the server shortened (fork, `lib/tool-bodies.ts`)
 * hands the references to the turn it is drawn in, so its row can load the
 * full text: the input's on `tool_use`, the output's (or the content's, when
 * there is no raw output) on `tool_result`.
 */

import { describe, expect, it, vi } from "vitest"

import { buildStreamingTurnsFromLiveMessage } from "@/stores/conversation-runtime-store"
import type {
  LiveMessage,
  ToolCallInfo,
} from "@/contexts/acp-connections-context"

vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(),
}))

const OUT = { id: "a".repeat(32), bytes: 400_000, extra_lines: 9_000 }
const IN = { id: "b".repeat(32), bytes: 60_000, extra_lines: 0 }
const CONTENT = { id: "c".repeat(32), bytes: 50_000, extra_lines: 10 }

function call(over: Partial<ToolCallInfo>): ToolCallInfo {
  return {
    tool_call_id: "call-1",
    title: "cat big.log",
    kind: "execute",
    status: "completed",
    content: null,
    raw_input: JSON.stringify({ command: "cat big.log" }),
    raw_output_chunks: ["start\n…\nend"],
    raw_output_total_bytes: 11,
    locations: null,
    meta: null,
    images: [],
    ...over,
  }
}

function blocks(info: ToolCallInfo) {
  const message: LiveMessage = {
    id: "lm-1",
    role: "assistant",
    startedAt: 0,
    content: [{ type: "tool_call", info }],
  }
  return buildStreamingTurnsFromLiveMessage(1, message).turns.flatMap(
    (turn) => turn.blocks
  )
}

describe("buildStreamingTurnsFromLiveMessage — shortened bodies", () => {
  it("puts the input's and the output's references on their blocks", () => {
    const built = blocks(call({ body_refs: { output: OUT, input: IN } }))
    expect(built.find((b) => b.type === "tool_use")).toMatchObject({
      body_refs: { input_preview: IN },
    })
    expect(built.find((b) => b.type === "tool_result")).toMatchObject({
      body_refs: { output_preview: OUT },
    })
  })

  it("takes the content's reference when the call has no raw output", () => {
    const built = blocks(
      call({
        raw_output_chunks: [],
        raw_output_total_bytes: 0,
        content: "a…z",
        body_refs: { content: CONTENT },
      })
    )
    expect(built.find((b) => b.type === "tool_result")).toMatchObject({
      output_preview: "a…z",
      body_refs: { output_preview: CONTENT },
    })
  })

  it("adds nothing to a call sent whole", () => {
    for (const block of blocks(call({}))) {
      expect(block).not.toHaveProperty("body_refs")
    }
  })
})
