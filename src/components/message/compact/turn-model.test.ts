import { describe, expect, it } from "vitest"

import { buildActivity } from "@/lib/activity/build-activity"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import {
  awaitingItems,
  editTotals,
  exceptionItems,
  filterActivityModel,
  groupHolds,
  groupLastStep,
  replyBlocks,
  stepIsLive,
  summarizeGroup,
  unrecoveredItems,
} from "./turn-model"

function toolPart(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
  opts: {
    output?: string
    state?:
      | "input-streaming"
      | "input-available"
      | "output-available"
      | "output-error"
    errorText?: string
  } = {}
): AdaptedContentPart {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input: JSON.stringify(input),
    output: opts.output ?? "ok",
    state: opts.state ?? "output-available",
    errorText: opts.errorText,
  }
}

describe("compact turn-model", () => {
  it("filters hideable tools by visibility level while keeping awaiting & non-hideable steps", () => {
    const parts: AdaptedContentPart[] = [
      { type: "reasoning", content: "thinking step", isStreaming: false },
      toolPart("t1", "Read", { file_path: "a.ts" }),
      toolPart(
        "t2",
        "Bash",
        { command: "pnpm test" },
        { state: "output-error", errorText: "exit 1" }
      ),
      toolPart(
        "t3",
        "Bash",
        { command: "sleep 10" },
        { state: "input-available", output: undefined }
      ),
      toolPart("t4", "AskUserQuestion", {
        questions: [{ question: "Proceed?" }],
      }),
      { type: "text", text: "intermediate note" },
      toolPart("t5", "Edit", {
        file_path: "a.ts",
        old_string: "a",
        new_string: "b",
      }),
      { type: "text", text: "final answer" },
    ]
    const model = buildActivity(parts, { isStreaming: false })

    // showAll keeps everything
    expect(filterActivityModel(model, "showAll")).toBe(model)

    // hideSuccessful hides succeeded Read & Edit, keeps failed Bash, running Bash, AskUserQuestion, thought, prose note
    const hideOk = filterActivityModel(model, "hideSuccessful")
    const hideOkIds = hideOk.steps.map((s) =>
      s.type === "tool" ? s.part.toolCallId : s.type
    )
    expect(hideOkIds).toContain("thought")
    expect(hideOkIds).toContain("note")
    expect(hideOkIds).toContain("t2")
    expect(hideOkIds).toContain("t3")
    expect(hideOkIds).toContain("t4")
    expect(hideOkIds).not.toContain("t1")
    expect(hideOkIds).not.toContain("t5")

    // hideAll hides all regular tools (even failed/running), keeps thought, prose note, AskUserQuestion
    const hideAll = filterActivityModel(model, "hideAll")
    const hideAllIds = hideAll.steps.map((s) =>
      s.type === "tool" ? s.part.toolCallId : s.type
    )
    expect(hideAllIds).toContain("thought")
    expect(hideAllIds).toContain("note")
    expect(hideAllIds).toContain("t4")
    expect(hideAllIds).not.toContain("t1")
    expect(hideAllIds).not.toContain("t2")
    expect(hideAllIds).not.toContain("t3")
    expect(hideAllIds).not.toContain("t5")
  })

  it("collects unrecovered failures, questions, plans, and images as standing exceptions", () => {
    const parts: AdaptedContentPart[] = [
      toolPart(
        "t1",
        "Bash",
        { command: "pnpm lint" },
        { state: "output-error", errorText: "exit 1" }
      ),
      toolPart("t2", "AskUserQuestion", {
        questions: [{ question: "Confirm?" }],
      }),
      {
        type: "plan",
        entries: [
          { content: "Step 1", priority: "high", status: "in_progress" },
        ],
        isStreaming: false,
      },
      {
        type: "generated-image",
        revisedPrompt: "cat",
        status: "completed",
        image: { data: "abc", mime_type: "image/png", name: "cat.png" },
      },
      toolPart("t3", "Read", { file_path: "ok.ts" }),
      { type: "text", text: "Done" },
    ]
    const model = buildActivity(parts, { isStreaming: false })

    expect(unrecoveredItems(model)).toHaveLength(1)
    expect(awaitingItems(model)).toHaveLength(0)

    const exceptions = exceptionItems(model)
    const types = exceptions.flatMap((i) =>
      i.type === "step"
        ? [i.step.type === "tool" ? i.step.tool.kind : i.step.type]
        : i.steps.map((s) => s.tool.kind)
    )
    expect(types).toContain("command") // unrecovered failure
    expect(types).toContain("question")
    expect(types).toContain("plan")
    expect(types).toContain("image")
    expect(types).not.toContain("read")
  })

  it("computes distinct editTotals and ignores failed edits", () => {
    const parts: AdaptedContentPart[] = [
      toolPart("e1", "Edit", {
        file_path: "src/a.ts",
        old_string: "one",
        new_string: "one\ntwo\nthree",
      }),
      toolPart("e2", "Edit", {
        file_path: "src/a.ts",
        old_string: "two",
        new_string: "TWO",
      }),
      toolPart(
        "e3",
        "Edit",
        { file_path: "src/bad.ts", old_string: "x", new_string: "y\nz" },
        { state: "output-error", errorText: "not found" }
      ),
      { type: "text", text: "Updated" },
    ]
    const model = buildActivity(parts, { isStreaming: false })
    const totals = editTotals(model)
    expect(totals.files).toBe(1)
    expect(totals.additions).toBeGreaterThan(0)
  })

  it("lays a reply out as prose, groups between them, and rows standing alone", () => {
    const parts: AdaptedContentPart[] = [
      toolPart("r1", "Read", { file_path: "a.ts" }),
      toolPart("r2", "Read", { file_path: "b.ts" }),
      toolPart("s1", "Grep", { pattern: "loginSchema" }),
      { type: "text", text: "Now editing" },
      toolPart("e1", "Edit", {
        file_path: "a.ts",
        old_string: "a",
        new_string: "b",
      }),
      toolPart("q1", "AskUserQuestion", {
        questions: [{ question: "Proceed?" }],
      }),
      toolPart("c1", "Bash", { command: "pnpm test" }),
      { type: "text", text: "All good" },
    ]
    const model = buildActivity(parts, { isStreaming: false })
    const blocks = replyBlocks(model.items)
    expect(blocks.map((b) => b.kind)).toEqual([
      "group",
      "prose",
      "group",
      "single",
      "group",
    ])
    const first = blocks[0]!
    if (first.kind !== "group") throw new Error("expected a group")
    const keyOf = (id: string) =>
      model.steps.find(
        (step) => step.type === "tool" && step.part.toolCallId === id
      )!.key
    expect(groupHolds(first.items, keyOf("r2"))).toBe(true)
    expect(groupHolds(first.items, keyOf("c1"))).toBe(false)
    const summary = summarizeGroup(first.items, model.summary.recoveredKeys)
    expect(summary.pieces).toEqual([
      { category: "readFiles", count: 2 },
      { category: "searches", count: 1 },
    ])
    expect(summary.failed).toBe(false)
  })

  it("names commands and edits first, then counts the other steps", () => {
    const parts: AdaptedContentPart[] = [
      toolPart("r1", "Read", { file_path: "a.ts" }),
      toolPart("s1", "Grep", { pattern: "x" }),
      toolPart("e1", "Edit", {
        file_path: "a.ts",
        old_string: "a",
        new_string: "b",
      }),
      toolPart(
        "c1",
        "Bash",
        { command: "pnpm test" },
        { state: "output-error", errorText: "exit 1" }
      ),
      toolPart("c2", "Bash", { command: "pnpm test" }),
      { type: "text", text: "Done" },
    ]
    const model = buildActivity(parts, { isStreaming: false })
    const steps = model.items
    const summary = summarizeGroup(steps, model.summary.recoveredKeys)
    expect(summary.pieces).toEqual([
      { category: "editedFiles", count: 1 },
      { category: "commands", count: 2 },
      { category: "other", count: 2 },
    ])
    // The failed run was redone: nothing to flag.
    expect(summary.failed).toBe(false)
  })

  it("flags a group whose failure nothing redid, and a thoughts-only group", () => {
    const failing = buildActivity(
      [
        toolPart(
          "c1",
          "Bash",
          { command: "pnpm lint" },
          { state: "output-error", errorText: "exit 1" }
        ),
        { type: "text", text: "Lint fails." },
      ],
      { isStreaming: false }
    )
    expect(
      summarizeGroup(failing.items, failing.summary.recoveredKeys).failed
    ).toBe(true)

    const thinking = buildActivity(
      [
        { type: "reasoning", content: "hmm", isStreaming: false },
        { type: "text", text: "Answer" },
      ],
      { isStreaming: false }
    )
    expect(
      summarizeGroup(thinking.items, thinking.summary.recoveredKeys).pieces
    ).toEqual([{ category: "thought", count: 1 }])
  })

  it("tells the step under way: a call not settled or a thought being written", () => {
    const live = buildActivity(
      [
        toolPart("r1", "Read", { file_path: "a.ts" }),
        toolPart(
          "c1",
          "Bash",
          { command: "sleep 5" },
          { state: "input-available", output: undefined }
        ),
      ],
      { isStreaming: true }
    )
    const last = groupLastStep(live.items)
    expect(last && stepIsLive(last)).toBe(true)

    const thinking = buildActivity(
      [{ type: "reasoning", content: "considering", isStreaming: true }],
      { isStreaming: true }
    )
    const thought = groupLastStep(thinking.items)
    expect(thought && stepIsLive(thought)).toBe(true)

    const settled = buildActivity(
      [toolPart("r1", "Read", { file_path: "a.ts" })],
      { isStreaming: true }
    )
    const read = groupLastStep(settled.items)
    expect(read && stepIsLive(read)).toBe(false)
  })
})
