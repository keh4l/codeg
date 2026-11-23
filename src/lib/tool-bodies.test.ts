import { afterEach, describe, expect, it, vi } from "vitest"

import type { AdaptedToolCallPart } from "@/lib/adapters/ai-elements-adapter"

const { getBlobText } = vi.hoisted(() => ({ getBlobText: vi.fn() }))
vi.mock("@/lib/api", () => ({ getBlobText }))

import {
  __resetToolBodiesForTests,
  bodyRefsFromEvent,
  extraLines,
  loadToolBody,
  mergeToolCallBodyRefs,
  withFullBodies,
  withFullToolBodies,
} from "./tool-bodies"

const OUT = { id: "a".repeat(32), bytes: 900_000, extra_lines: 12_000 }
const IN = { id: "b".repeat(32), bytes: 50_000, extra_lines: 0 }
const CONTENT = { id: "c".repeat(32), bytes: 40_000, extra_lines: 3 }

afterEach(() => {
  __resetToolBodiesForTests()
  getBlobText.mockReset()
})

function part(over: Partial<AdaptedToolCallPart> = {}): AdaptedToolCallPart {
  return {
    type: "tool-call",
    toolCallId: "t1",
    toolName: "Bash",
    input: '{"command":"cat big.log"}',
    state: "output-available",
    output: "start\n…\nend",
    ...over,
  }
}

describe("tool-bodies", () => {
  it("keeps a live call's references right as updates revise it", () => {
    const created = bodyRefsFromEvent({ raw_output: OUT, raw_input: IN })
    expect(created).toEqual({ output: OUT, input: IN })
    expect(bodyRefsFromEvent(null)).toBeUndefined()

    // Nothing replaced: the references stay.
    const none = { raw_output: null, content: null, raw_input: null }
    expect(mergeToolCallBodyRefs(created, none)).toEqual(created)
    // Output replaced by a body that fits: its reference goes.
    expect(
      mergeToolCallBodyRefs(created, { ...none, raw_output: "short" })
    ).toEqual({ input: IN })
    // Output appended to: no reference describes the text any more.
    expect(
      mergeToolCallBodyRefs(created, {
        ...none,
        raw_output: "more",
        raw_output_append: true,
      })
    ).toEqual({ input: IN })
    // Content replaced by a shortened one.
    expect(
      mergeToolCallBodyRefs(undefined, {
        ...none,
        content: "x…y",
        body_refs: { content: CONTENT },
      })
    ).toEqual({ content: CONTENT })
    expect(mergeToolCallBodyRefs(undefined, none)).toBeUndefined()
    expect(extraLines(OUT)).toBe(12_000)
    expect(extraLines(undefined)).toBe(0)
  })

  it("puts the full texts back in place of the shortened ones", () => {
    const shortened = part({
      input: '{"command":"cat big.log","description":"Show the log"}',
      errorText: "start\n…\nend",
      bodyRefs: { input: IN, output: OUT },
    })
    expect(withFullBodies(shortened, null, null)).toBe(shortened)

    const outputOnly = withFullBodies(shortened, null, "start\nmiddle\nend")
    expect(outputOnly.output).toBe("start\nmiddle\nend")
    expect(outputOnly.errorText).toBe("start\nmiddle\nend")
    expect(outputOnly.bodyRefs).toEqual({ input: IN })

    // A field merged into the input on this side survives the full input.
    const both = withFullBodies(
      shortened,
      '{"command":"cat big.log --all"}',
      "full"
    )
    expect(JSON.parse(both.input!)).toEqual({
      command: "cat big.log --all",
      description: "Show the log",
    })
    expect(both.bodyRefs).toBeUndefined()
  })

  it("loads each full text once, however many rows ask", async () => {
    let resolve!: (text: string) => void
    getBlobText.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done
      })
    )
    const first = loadToolBody(OUT)
    const second = loadToolBody(OUT)
    resolve("the whole log")
    expect(await first).toBe("the whole log")
    expect(await second).toBe("the whole log")
    expect(await loadToolBody(OUT)).toBe("the whole log")
    expect(getBlobText).toHaveBeenCalledExactlyOnceWith(OUT.id)
  })

  it("lets a failed load be tried again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    getBlobText.mockRejectedValueOnce(new Error("offline"))
    expect(await loadToolBody(OUT)).toBeNull()
    getBlobText.mockResolvedValueOnce("back")
    expect(await loadToolBody(OUT)).toBe("back")
  })

  it("exports every shortened body whole and leaves the input as it was", async () => {
    getBlobText.mockImplementation(async (id: string) =>
      id === OUT.id ? "full output" : "full input"
    )
    const detail = {
      turns: [
        {
          blocks: [
            {
              type: "tool_use",
              input_preview: "in…put",
              body_refs: { input_preview: IN },
            },
            {
              type: "tool_result",
              output_preview: "out…put",
              body_refs: { output_preview: OUT },
            },
            { type: "text", text: "hi" },
          ],
        },
      ],
    }
    const whole = await withFullToolBodies(detail)
    expect(whole.turns[0].blocks).toEqual([
      { type: "tool_use", input_preview: "full input" },
      { type: "tool_result", output_preview: "full output" },
      { type: "text", text: "hi" },
    ])
    expect(detail.turns[0].blocks[1]).toHaveProperty("body_refs")
  })
})
