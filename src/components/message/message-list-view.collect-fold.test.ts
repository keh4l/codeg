// keh4l build: collect calls (`image_get_result`, `get_question_answer`) that
// land in a later sub-turn join the card of what they collect when the reply's
// sub-turns are merged into one timeline.
import { describe, expect, it } from "vitest"

import {
  mergeConsecutiveAssistantTurns,
  type MergedAssistantRunCache,
  type ResolvedMessageGroup,
  type ThreadRenderItem,
} from "./message-list-view"
import type {
  AdaptedContentPart,
  AdaptedToolCallPart,
} from "@/lib/adapters/ai-elements-adapter"
import {
  foldCollectCalls,
  type AdaptedImageJobPart,
} from "@/lib/image-gen/tool-calls"

const RUNNING =
  "Still generating (job_id=img-abc, 45.0 s so far).\n" +
  'Call image_get_result with job_ids ["img-abc"] to wait for the rest; do not start the same image again.'
const SAVED =
  "Image saved to /tmp/cat.png (1024x1024, image/png, gpt-image-1 via OpenAI, 12.3 s). job_id=img-abc"
const PENDING =
  'The user has not answered yet; the question is still in front of them. Call get_question_answer with question_id "q-1" to keep waiting for the answer.'

function mcp(text: string): string {
  return JSON.stringify({ content: [{ type: "text", text }], isError: false })
}

function call(
  id: string,
  toolName: string,
  output: string,
  input: Record<string, unknown> = {}
): AdaptedToolCallPart {
  return {
    type: "tool-call",
    toolCallId: id,
    toolName,
    input: JSON.stringify(input),
    state: "output-available",
    output,
  }
}

// What the per-turn adapter hands on: each turn already folded on its own.
function group(id: string, parts: AdaptedContentPart[]): ResolvedMessageGroup {
  return {
    id,
    role: "assistant",
    parts: foldCollectCalls(parts),
    resources: [],
    images: [],
  }
}

function item(g: ResolvedMessageGroup, index: number): ThreadRenderItem {
  return {
    key: `persisted-${g.id}-${index}`,
    kind: "turn",
    group: g,
    phase: "persisted",
    isResponseComplete: true,
    showStats: false,
    isRoleTransition: false,
    previousUserIndex: null,
    isLastAssistantRun: false,
    isThreadTail: false,
    sourceTurns: [],
  }
}

function mergedParts(
  items: ThreadRenderItem[],
  cache?: MergedAssistantRunCache
) {
  const out = mergeConsecutiveAssistantTurns(items, cache)
  expect(out).toHaveLength(1)
  const merged = out[0]
  if (merged.kind !== "turn") throw new Error("expected a turn")
  return merged.group.parts
}

describe("merged sub-turns fold collect calls (keh4l build)", () => {
  const text: AdaptedContentPart = { type: "text", text: "Here it is" }

  it("folds a later turn's image_get_result into the image's card", () => {
    const start = call("start", "mcp__codeg-mcp__image_generate", mcp(RUNNING))
    const poll = call("poll", "mcp__codeg-mcp__image_get_result", mcp(SAVED), {
      job_ids: ["img-abc"],
    })
    const parts = mergedParts([
      item(group("a1", [start]), 0),
      item(group("a2", [poll, text]), 1),
    ])
    expect(parts).toHaveLength(2)
    const card = parts[0] as AdaptedImageJobPart
    expect(card.type).toBe("image-job")
    expect(card.call).toBe(start)
    expect(card.polls).toEqual([poll])
    expect(parts[1]).toBe(text)
  })

  it("gives a question asked in one turn the answer collected in a later one", () => {
    const ask = call("ask", "mcp__codeg-mcp__ask_user_question", mcp(PENDING))
    const answer = call(
      "answer",
      "mcp__codeg-mcp__get_question_answer",
      mcp("User answered: A"),
      { question_id: "q-1" }
    )
    const parts = mergedParts([
      item(group("a1", [ask]), 0),
      item(group("a2", [answer, text]), 1),
    ])
    expect(parts).toHaveLength(2)
    const card = parts[0] as AdaptedToolCallPart
    expect(card.toolCallId).toBe("ask")
    expect(card.output).toBe(answer.output)
  })

  it("still folds when the run grows on top of a cached merge", () => {
    // While a reply streams, the run's merge starts from its last one; the
    // collect arrives in a turn that was not there when that merge was made.
    const cache: MergedAssistantRunCache = new WeakMap()
    const start = call("start", "image_generate", mcp(RUNNING))
    const g1 = group("a1", [start])
    const g2 = group("a2", [text])
    mergedParts([item(g1, 0), item(g2, 1)], cache)
    const poll = call("poll", "image_get_result", mcp(SAVED), {
      job_ids: ["img-abc"],
    })
    const parts = mergedParts(
      [item(g1, 0), item(g2, 1), item(group("a3", [poll]), 2)],
      cache
    )
    expect(parts).toHaveLength(2)
    expect((parts[0] as AdaptedImageJobPart).polls).toEqual([poll])
  })
})
