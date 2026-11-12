// keh4l build: the submit binding fills the predicted follow-up prompt into an
// empty composer (as Tab does) and sends only on the next press, so a phone
// keyboard, which has no Tab, can take the suggestion too.
import { act, render, waitFor } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { RichComposer, type RichComposerHandle } from "./rich-composer"

async function mount(props: React.ComponentProps<typeof RichComposer> = {}) {
  const ref = createRef<RichComposerHandle>()
  const result = render(<RichComposer ref={ref} {...props} />)
  await waitFor(() => expect(ref.current?.getEditor()).not.toBeNull(), {
    timeout: 5000,
  })
  return { ref, ...result }
}

function press(
  ref: React.RefObject<RichComposerHandle | null>,
  init: KeyboardEventInit
): KeyboardEvent {
  const dom = ref.current?.getEditor()?.view.dom as HTMLElement
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  act(() => {
    dom.dispatchEvent(event)
  })
  return event
}

describe("RichComposer submit key takes the suggestion (keh4l build)", () => {
  it("fills the empty document on Enter, then sends on the next Enter", async () => {
    const onSubmit = vi.fn()
    const onChange = vi.fn()
    const { ref } = await mount({
      onSubmit,
      onChange,
      promptSuggestion: "  Run the tests  ",
      submitFillsSuggestion: true,
    })
    expect(press(ref, { key: "Enter" }).defaultPrevented).toBe(true)
    expect(ref.current?.getText()).toBe("Run the tests")
    expect(onSubmit).not.toHaveBeenCalled()
    // An ordinary edit, caret after the text — the same fill as Tab.
    expect(onChange).toHaveBeenLastCalledWith("Run the tests")
    const { selection, doc } = ref.current!.getEditor()!.state
    expect(selection.empty).toBe(true)
    expect(selection.to).toBe(doc.content.size - 1)

    press(ref, { key: "Enter" })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(ref.current?.getText()).toBe("Run the tests")
  })

  it("sends what is typed rather than the suggestion", async () => {
    const onSubmit = vi.fn()
    const { ref } = await mount({
      onSubmit,
      promptSuggestion: "Run the tests",
      submitFillsSuggestion: true,
    })
    act(() => ref.current?.setText("my own words"))
    press(ref, { key: "Enter" })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(ref.current?.getText()).toBe("my own words")
  })

  it("keeps the upstream submit when the host does not ask for the fill", async () => {
    for (const submitFillsSuggestion of [undefined, false]) {
      const onSubmit = vi.fn()
      const { ref, unmount } = await mount({
        onSubmit,
        promptSuggestion: "Run the tests",
        submitFillsSuggestion,
      })
      press(ref, { key: "Enter" })
      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(ref.current?.isEmpty()).toBe(true)
      unmount()
    }
  })

  it("submits as before with no suggestion or a blank one", async () => {
    for (const promptSuggestion of [null, "   "]) {
      const onSubmit = vi.fn()
      const { ref, unmount } = await mount({
        onSubmit,
        promptSuggestion,
        submitFillsSuggestion: true,
      })
      press(ref, { key: "Enter" })
      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(ref.current?.isEmpty()).toBe(true)
      unmount()
    }
  })

  it("leaves an IME's Enter alone", async () => {
    const onSubmit = vi.fn()
    const { ref } = await mount({
      onSubmit,
      promptSuggestion: "Run the tests",
      submitFillsSuggestion: true,
    })
    press(ref, { key: "Enter", isComposing: true })
    press(ref, { key: "Process", keyCode: 229 })
    expect(ref.current?.isEmpty()).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("follows the configured send key, not Enter as such", async () => {
    const onSubmit = vi.fn()
    const { ref } = await mount({
      onSubmit,
      submitShortcut: "mod+enter",
      newlineShortcut: "enter",
      promptSuggestion: "Run the tests",
      submitFillsSuggestion: true,
    })
    // Enter is the newline key here: no fill.
    press(ref, { key: "Enter" })
    expect(ref.current?.getText()).not.toContain("Run the tests")
    act(() => ref.current?.clear())

    press(ref, { key: "Enter", ctrlKey: true })
    press(ref, { key: "Enter", metaKey: true })
    // One of the two is `mod` on this platform: it filled, and the other
    // press did nothing to it (no submit while it is not the binding).
    expect(ref.current?.getText()).toBe("Run the tests")
  })
})
