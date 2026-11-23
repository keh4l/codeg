import { deflateSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"
import {
  inflateFrame,
  supportsCompressedFrames,
  WS_FRAME_TAG_LAST,
  WS_FRAME_TAG_PART,
  WS_FRAME_TAG_WHOLE,
  WsFrameDecoder,
} from "./ws-frame-decoder"

function tagged(tag: number, bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.length + 1)
  out[0] = tag
  out.set(bytes, 1)
  return out.buffer
}

/** One JSON frame as the server sends it on v2: zlib, in `parts` pieces. */
function compressed(json: string, parts = 1): ArrayBuffer[] {
  const stream = new Uint8Array(deflateSync(Buffer.from(json, "utf8")))
  if (parts === 1) return [tagged(WS_FRAME_TAG_WHOLE, stream)]
  const size = Math.ceil(stream.length / parts)
  const out: ArrayBuffer[] = []
  for (let i = 0; i < parts; i++) {
    const piece = stream.subarray(i * size, (i + 1) * size)
    out.push(
      tagged(i === parts - 1 ? WS_FRAME_TAG_LAST : WS_FRAME_TAG_PART, piece)
    )
  }
  return out
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

describe("ws-frame-decoder", () => {
  it("is supported where DecompressionStream is", () => {
    expect(supportsCompressedFrames()).toBe(true)
  })

  it("inflates a zlib stream given in pieces, multi-byte text included", async () => {
    const json = JSON.stringify({ text: "登录表单校验 ".repeat(2000) })
    const stream = new Uint8Array(deflateSync(Buffer.from(json, "utf8")))
    const pieces = [stream.subarray(0, 7), stream.subarray(7)]
    expect(await inflateFrame(pieces)).toBe(json)
  })

  it("delivers a text frame at once when nothing is pending", () => {
    const deliver = vi.fn()
    const decoder = new WsFrameDecoder(deliver)
    decoder.push('{"type":"pong"}')
    expect(deliver).toHaveBeenCalledWith('{"type":"pong"}')
  })

  it("keeps arrival order across compressed, split and text frames", async () => {
    const seen: string[] = []
    const decoder = new WsFrameDecoder((text) => seen.push(text))
    const big = JSON.stringify({ n: 1, body: "x".repeat(50_000) })
    const [first, second, third] = compressed(big, 3)

    decoder.push(first)
    // A text message between parts is complete on its own; it arrived
    // before the split frame was whole, so it is delivered first.
    decoder.push('{"n":0}')
    decoder.push(second)
    decoder.push(third)
    // Text after a frame that is still inflating waits its turn.
    decoder.push('{"n":2}')
    for (const part of compressed('{"n":3}')) decoder.push(part)
    decoder.push('{"n":4}')

    await settle()
    expect(seen.map((t) => JSON.parse(t).n)).toEqual([0, 1, 2, 3, 4])
    expect(JSON.parse(seen[1]).body).toHaveLength(50_000)
    expect(decoder.pending).toBe(0)
  })

  it("drops what is in flight on reset", async () => {
    const deliver = vi.fn()
    const decoder = new WsFrameDecoder(deliver)
    for (const part of compressed('{"stale":true}')) decoder.push(part)
    decoder.push('{"queued":true}')
    const [partial] = compressed(JSON.stringify("y".repeat(40_000)), 2)
    decoder.push(partial)
    decoder.reset()
    await settle()
    expect(deliver).not.toHaveBeenCalled()

    // A fresh socket starts clean: no leftover part is joined to its frames.
    for (const part of compressed('{"fresh":true}')) decoder.push(part)
    await settle()
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver).toHaveBeenCalledWith('{"fresh":true}')
  })

  it("ignores a reserved tag and reports a frame that will not inflate", async () => {
    const deliver = vi.fn()
    const onError = vi.fn()
    const decoder = new WsFrameDecoder(deliver, onError)
    decoder.push(tagged(0x7f, new Uint8Array([1, 2, 3])))
    decoder.push(tagged(WS_FRAME_TAG_WHOLE, new Uint8Array([1, 2, 3])))
    decoder.push('{"after":true}')
    await settle()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(deliver).toHaveBeenCalledWith('{"after":true}')
  })
})
