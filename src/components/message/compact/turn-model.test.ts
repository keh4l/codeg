import { describe, expect, it } from "vitest"

import { buildActivity } from "@/lib/activity/build-activity"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import {
  awaitingItems,
  editTotals,
  exceptionItems,
  filterActivityModel,
  segmentItems,
  summarizeItems,
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

  it("splits live items into prose and step runs and summarizes each run", () => {
    const parts: AdaptedContentPart[] = [
      toolPart("r1", "Read", { file_path: "a.ts" }),
      toolPart("r2", "Read", { file_path: "b.ts" }),
      { type: "text", text: "Now editing" },
      toolPart("c1", "Bash", { command: "pnpm test" }),
      { type: "text", text: "All good" },
    ]
    const model = buildActivity(parts, { isStreaming: true })
    const segments = segmentItems(model.items)
    expect(segments.map((s) => s.kind)).toEqual(["run", "prose", "run"])
    if (segments[0]?.kind === "run") {
      expect(summarizeItems(segments[0].items).counts.readFiles).toBe(2)
    }
    if (segments[2]?.kind === "run") {
      expect(summarizeItems(segments[2].items).counts.commands).toBe(1)
    }
  })
})
