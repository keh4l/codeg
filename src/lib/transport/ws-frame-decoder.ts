// `/ws/events` protocol v2 frame decoding (fork). The byte format is defined
// in `src-tauri/src/web/ws_frame.rs`:
//
// - a text message is one complete JSON frame (as in v1);
// - a binary message is a tag byte and a piece of a zlib stream that inflates
//   to one JSON frame: 0x01 the whole stream, 0x02 a part (more follow),
//   0x03 the last part. Text messages (pongs, detaches) may arrive between
//   the parts of a frame; they are complete on their own.
//
// Inflating is asynchronous, but the attach protocol relies on frames being
// applied in the order they arrived (`lastAppliedSeq`). So once any frame is
// still inflating, later frames — text included — wait in a queue and are
// delivered in arrival order. With nothing pending, a text frame is delivered
// synchronously, exactly as before.

export const WS_FRAME_TAG_WHOLE = 0x01
export const WS_FRAME_TAG_PART = 0x02
export const WS_FRAME_TAG_LAST = 0x03

/**
 * Whether this browser can inflate v2 frames. Offered only then: a client
 * that could not read binary frames must stay on v1. Works in insecure
 * contexts (plain http to an IP) too.
 */
export function supportsCompressedFrames(): boolean {
  try {
    if (typeof DecompressionStream !== "function") return false
    new DecompressionStream("deflate")
    return true
  } catch {
    return false
  }
}

/** Inflate a zlib (RFC 1950) stream given in pieces, as UTF-8 text. */
export async function inflateFrame(pieces: Uint8Array[]): Promise<string> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece)
      controller.close()
    },
  })
  const reader = source
    .pipeThrough(
      new DecompressionStream("deflate") as unknown as TransformStream<
        Uint8Array,
        Uint8Array
      >
    )
    .getReader()
  const decoder = new TextDecoder()
  let text = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

interface QueuedFrame {
  text: string | null
  done: boolean
}

export class WsFrameDecoder {
  private parts: Uint8Array[] = []
  private queue: QueuedFrame[] = []
  // Bumped by `reset()` so an inflate that finishes after a teardown is
  // dropped instead of delivered to the next socket's handlers.
  private generation = 0

  constructor(
    private readonly deliver: (text: string) => void,
    private readonly onDecodeError: (error: unknown) => void = () => {}
  ) {}

  /** Feed one WebSocket message (`MessageEvent.data`). */
  push(data: unknown): void {
    if (typeof data === "string") {
      if (this.queue.length === 0) {
        this.deliver(data)
      } else {
        this.queue.push({ text: data, done: true })
      }
      return
    }
    let bytes: Uint8Array
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data)
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    } else {
      return
    }
    if (bytes.length === 0) return
    const body = bytes.subarray(1)
    switch (bytes[0]) {
      case WS_FRAME_TAG_WHOLE:
        this.parts = []
        this.inflate([body])
        break
      case WS_FRAME_TAG_PART:
        this.parts.push(body)
        break
      case WS_FRAME_TAG_LAST: {
        const pieces = [...this.parts, body]
        this.parts = []
        this.inflate(pieces)
        break
      }
      default:
        // Reserved tag: a frame this client cannot read.
        break
    }
  }

  /** Drop everything in flight (the socket is gone). */
  reset(): void {
    this.generation++
    this.parts = []
    this.queue = []
  }

  /** Frames received but not yet delivered (inflating or queued behind). */
  get pending(): number {
    return this.queue.length
  }

  private inflate(pieces: Uint8Array[]): void {
    const entry: QueuedFrame = { text: null, done: false }
    this.queue.push(entry)
    const generation = this.generation
    inflateFrame(pieces).then(
      (text) => {
        if (generation !== this.generation) return
        entry.text = text
        entry.done = true
        this.drain()
      },
      (error: unknown) => {
        if (generation !== this.generation) return
        entry.done = true
        this.drain()
        this.onDecodeError(error)
      }
    )
  }

  private drain(): void {
    while (this.queue.length > 0 && this.queue[0].done) {
      const entry = this.queue.shift()!
      if (entry.text === null) continue
      try {
        this.deliver(entry.text)
      } catch (err) {
        console.error("[WsFrameDecoder] frame handler threw:", err)
      }
    }
  }
}
