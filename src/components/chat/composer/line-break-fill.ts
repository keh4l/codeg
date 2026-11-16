/**
 * keh4l build: a phone's line-break key takes the predicted follow-up prompt.
 *
 * The composer's own Enter handling never sees that key on a phone. Chrome on
 * Android hands ProseMirror no Enter keydown at all (it waits for the DOM
 * change instead); many input methods send the key as a typed line break with
 * no keydown; and the Enter ProseMirror replays after detecting either one
 * carries no modifier flags, which the send binding does not match. So what
 * reaches the document is just a line break.
 *
 * This extension catches that result instead of the key: when the document
 * was empty and a line-break input (`beforeinput`: `insertParagraph`,
 * `insertLineBreak`, or typed `\n`) leaves nothing but blank lines in it, the
 * line break is replaced with the suggestion, caret at the end — what the send
 * key does on a keyboard. With text in the box a line break stays a line
 * break, so a phone still writes multi-line messages and sends with the
 * button.
 */

import { Extension, type JSONContent } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import {
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
} from "@tiptap/pm/state"

/** How long after a line-break input its document change is still its own. */
const LINE_BREAK_WINDOW_MS = 1000

/**
 * How long after a fill an Enter still belongs to the key that filled: iOS
 * replays its Enter ~200 ms after the key, whether or not the DOM change was
 * already handled.
 */
const SAME_PRESS_MS = 500

/** What the composer offers right now, read at the moment of the input. */
export interface LineBreakFillOptions {
  /** The suggestion to fill, or nothing when none is offered. */
  getSuggestion: () => string | null | undefined
  /** Whether the host lets the line break take the suggestion at all. */
  isEnabled: () => boolean
  /** The document a suggestion fills in (badges hydrated). */
  toDoc: (text: string) => JSONContent
}

/** A `beforeinput` whose effect is a new line. */
export function isLineBreakInput(
  event: Pick<InputEvent, "inputType" | "data">
): boolean {
  if (
    event.inputType === "insertParagraph" ||
    event.inputType === "insertLineBreak"
  ) {
    return true
  }
  return (
    event.inputType.startsWith("insert") &&
    !!event.data &&
    /^[\r\n]+$/.test(event.data)
  )
}

/** One empty paragraph: what the composer holds before anything is typed. */
export function isEmptyDocument(doc: PMNode): boolean {
  return (
    doc.childCount === 1 &&
    doc.firstChild!.isTextblock &&
    doc.firstChild!.childCount === 0
  )
}

/** Nothing but line breaks and whitespace (and at least one of them). */
export function isBlankDocument(doc: PMNode): boolean {
  if (isEmptyDocument(doc)) return false
  let blank = true
  doc.descendants((node) => {
    if (!blank) return false
    if (node.isText) {
      if (node.text!.trim() !== "") blank = false
    } else if (node.isInline && node.type.name !== "hardBreak") {
      blank = false
    }
    return true
  })
  return blank
}

/** When the last fill happened (`Date.now()`), 0 before the first. */
const lineBreakFillKey = new PluginKey<number>("keh4lLineBreakFill")

/**
 * Whether a line break filled the suggestion a moment ago — an Enter now is
 * that same press replayed and must not send what it filled.
 */
export function justFilledByLineBreak(
  state: EditorState,
  now = Date.now()
): boolean {
  const filledAt = lineBreakFillKey.getState(state) ?? 0
  return filledAt > 0 && now - filledAt < SAME_PRESS_MS
}

export function createLineBreakFillExtension(options: LineBreakFillOptions) {
  return Extension.create({
    name: "keh4lLineBreakFill",
    addProseMirrorPlugins() {
      // Per editor: when the last line-break input happened.
      let lineBreakAt = 0
      return [
        new Plugin({
          key: lineBreakFillKey,
          state: {
            init: () => 0,
            apply: (tr, filledAt: number) =>
              (tr.getMeta(lineBreakFillKey) as number | undefined) ?? filledAt,
          },
          props: {
            handleDOMEvents: {
              beforeinput: (_view, event) => {
                if (isLineBreakInput(event)) lineBreakAt = Date.now()
                return false
              },
            },
          },
          appendTransaction(transactions, oldState, newState) {
            if (Date.now() - lineBreakAt > LINE_BREAK_WINDOW_MS) return null
            if (!transactions.some((tr) => tr.docChanged)) return null
            if (!isEmptyDocument(oldState.doc)) return null
            if (!isBlankDocument(newState.doc)) return null
            const suggestion = options.getSuggestion()?.trim()
            if (!suggestion || !options.isEnabled()) return null
            lineBreakAt = 0
            const filled = newState.schema.nodeFromJSON(
              options.toDoc(suggestion)
            )
            const tr = newState.tr.replaceWith(
              0,
              newState.doc.content.size,
              filled.content
            )
            tr.setSelection(Selection.atEnd(tr.doc))
            tr.setMeta(lineBreakFillKey, Date.now())
            return tr
          },
        }),
      ]
    },
  })
}
