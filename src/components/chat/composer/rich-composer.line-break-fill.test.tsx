// keh4l build: a phone's line-break key takes the predicted follow-up prompt
// into the empty composer. jsdom does no native editing, so each test plays
// what the browser does: the `beforeinput` it fires, then the document change
// ProseMirror reads back from the DOM.
import { act, render, waitFor } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  isBlankDocument,
  isEmptyDocument,
  isLineBreakInput,
} from "./line-break-fill"
import { RichComposer, type RichComposerHandle } from "./rich-composer"

async function mount(props: React.ComponentProps<typeof RichComposer> = {}) {
  const ref = createRef<RichComposerHandle>()
  const result = render(<RichComposer ref={ref} {...props} />)
  await waitFor(() => expect(ref.current?.getEditor()).not.toBeNull(), {
    timeout: 5000,
  })
  return { ref, ...result }
}

type Ref = React.RefObject<RichComposerHandle | null>
const view = (ref: Ref) => ref.current!.getEditor()!.view

function beforeInput(ref: Ref, inputType: string, data: string | null = null) {
  view(ref).dom.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType,
      data,
      bubbles: true,
      cancelable: true,
    })
  )
}

/** The browser's own line break: a new paragraph after the caret. */
function phoneLineBreak(ref: Ref, inputType = "insertParagraph") {
  act(() => {
    beforeInput(ref, inputType)
    const v = view(ref)
    v.dispatch(v.state.tr.split(v.state.selection.from))
  })
}

/** An input method typing `\n`, read back as a hard break. */
function imeNewline(ref: Ref) {
  act(() => {
    beforeInput(ref, "insertText", "\n")
    const v = view(ref)
    v.dispatch(
      v.state.tr.replaceSelectionWith(v.state.schema.nodes.hardBreak.create())
    )
  })
}

function press(ref: Ref, init: KeyboardEventInit) {
  act(() => {
    view(ref).dom.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
    )
  })
}

const offered = {
  promptSuggestion: "  Run the tests  ",
  submitFillsSuggestion: true,
}

describe("line-break input detection", () => {
  it("counts paragraph and line breaks, and typed newlines", () => {
    expect(isLineBreakInput({ inputType: "insertParagraph", data: null })).toBe(
      true
    )
    expect(isLineBreakInput({ inputType: "insertLineBreak", data: null })).toBe(
      true
    )
    expect(isLineBreakInput({ inputType: "insertText", data: "\n" })).toBe(true)
    expect(isLineBreakInput({ inputType: "insertText", data: "\r\n" })).toBe(
      true
    )
  })

  it("does not count text, deletions or a paste", () => {
    expect(isLineBreakInput({ inputType: "insertText", data: "a\n" })).toBe(
      false
    )
    expect(isLineBreakInput({ inputType: "insertText", data: " " })).toBe(false)
    expect(
      isLineBreakInput({ inputType: "deleteContentBackward", data: null })
    ).toBe(false)
    expect(isLineBreakInput({ inputType: "insertFromPaste", data: null })).toBe(
      false
    )
  })
})

describe("blank documents", () => {
  it("tells an untouched composer from one holding only line breaks", async () => {
    const { ref } = await mount()
    const schema = ref.current!.getEditor()!.schema
    const doc = (json: object) => schema.nodeFromJSON(json)
    const p = (content?: object[]) => ({ type: "paragraph", content })
    const empty = doc({ type: "doc", content: [p()] })
    const twoLines = doc({ type: "doc", content: [p(), p()] })
    const hardBreak = doc({
      type: "doc",
      content: [p([{ type: "hardBreak" }])],
    })
    const spaces = doc({
      type: "doc",
      content: [p([{ type: "text", text: "  " }, { type: "hardBreak" }])],
    })
    const text = doc({
      type: "doc",
      content: [p([{ type: "hardBreak" }, { type: "text", text: "hi" }])],
    })
    expect(isEmptyDocument(empty)).toBe(true)
    expect(isBlankDocument(empty)).toBe(false)
    for (const blank of [twoLines, hardBreak, spaces]) {
      expect(isEmptyDocument(blank)).toBe(false)
      expect(isBlankDocument(blank)).toBe(true)
    }
    expect(isBlankDocument(text)).toBe(false)
  })
})

describe("RichComposer line-break key takes the suggestion (keh4l build)", () => {
  afterEach(() => vi.restoreAllMocks())

  it("fills the empty composer instead of breaking the line", async () => {
    const onSubmit = vi.fn()
    const onChange = vi.fn()
    const { ref } = await mount({ ...offered, onSubmit, onChange })
    phoneLineBreak(ref)
    expect(ref.current?.getText()).toBe("Run the tests")
    expect(onChange).toHaveBeenLastCalledWith("Run the tests")
    const { selection, doc } = ref.current!.getEditor()!.state
    expect(doc.childCount).toBe(1)
    expect(selection.empty).toBe(true)
    expect(selection.to).toBe(doc.content.size - 1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("fills on an input method's typed newline and a soft line break", async () => {
    for (const lineBreak of [
      imeNewline,
      (r: Ref) => phoneLineBreak(r, "insertLineBreak"),
    ]) {
      const { ref, unmount } = await mount(offered)
      lineBreak(ref)
      expect(ref.current?.getText()).toBe("Run the tests")
      unmount()
    }
  })

  it("does not send on the Enter replayed for the same press", async () => {
    const onSubmit = vi.fn()
    const { ref } = await mount({ ...offered, onSubmit })
    const start = Date.now()
    const now = vi.spyOn(Date, "now").mockReturnValue(start)
    phoneLineBreak(ref)
    now.mockReturnValue(start + 200)
    press(ref, { key: "Enter" })
    expect(onSubmit).not.toHaveBeenCalled()
    // A later Enter from a keyboard is a second press, and sends.
    now.mockReturnValue(start + 1500)
    press(ref, { key: "Enter" })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(ref.current?.getText()).toBe("Run the tests")
  })

  it("keeps a line break once something is typed", async () => {
    const { ref } = await mount(offered)
    act(() => ref.current?.setText("my own words"))
    act(() => {
      ref.current!.getEditor()!.commands.focus("end")
    })
    phoneLineBreak(ref)
    expect(ref.current?.getText()).toBe("my own words\n")
  })

  it("keeps a second line break after the fill", async () => {
    const start = Date.now()
    const now = vi.spyOn(Date, "now").mockReturnValue(start)
    const { ref } = await mount(offered)
    phoneLineBreak(ref)
    now.mockReturnValue(start + 2000)
    phoneLineBreak(ref)
    expect(ref.current?.getText()).toBe("Run the tests\n")
  })

  it("leaves the line break alone without an offer to fill", async () => {
    for (const props of [
      { promptSuggestion: "Run the tests", submitFillsSuggestion: false },
      { promptSuggestion: "Run the tests" },
      { promptSuggestion: "   ", submitFillsSuggestion: true },
      { submitFillsSuggestion: true },
    ]) {
      const { ref, unmount } = await mount(props)
      phoneLineBreak(ref)
      expect(ref.current?.getText()).toBe("\n")
      unmount()
    }
  })

  it("leaves the newline binding's line break alone", async () => {
    // Shift+Enter on a keyboard is handled before the browser edits anything,
    // so no line-break input comes with it.
    const { ref } = await mount(offered)
    press(ref, { key: "Enter", shiftKey: true })
    expect(ref.current?.getText()).toBe("\n")
  })

  it("does not fill on a change that came without a line-break input", async () => {
    const { ref } = await mount(offered)
    act(() => {
      const v = view(ref)
      v.dispatch(v.state.tr.split(1))
    })
    expect(ref.current?.getText()).toBe("\n")
  })
})
