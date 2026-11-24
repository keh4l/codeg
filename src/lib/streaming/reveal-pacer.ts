// keh4l build: streamed text shown at a steady pace (option A, chosen by the
// user 2026-11-23 from the prototype in proto-stream-reveal).
//
// Over a slow, lossy link the reply arrives in bursts — nothing for half a
// second or more, then a paragraph at once — so it jumped instead of growing.
// The pacer holds a small buffer and shows the text at the rate it has been
// arriving, a little behind it:
//
// - The target lag L is the longest recent stall of the link × 1.1 (capped
//   at 1.5 s), learned across turns and fading with a 15 s half-life. Below
//   250 ms there is nothing to smooth, and everything shows at once — which
//   is also what a local desktop window and a LAN see.
// - A stall only counts when the delivery after it carries the text that
//   piled up during it. A model that pauses and then goes on at its own pace
//   is not a bursty link.
// - Each tick shows the arrival rate of the last 4 s × a factor: faster while
//   more than L is waiting, slower while less (0.25–3×). Once nothing has
//   come for longer than L it stops slowing down: the stream ended, or the
//   next delivery is late anyway.
//
// Anything that must keep wire order — a tool card, a permission prompt, the
// end of the turn — still releases everything at once (`flushStreamingQueue`
// in `acp-connections-context.tsx`).

/** How often held text is released. */
export const PACER_TICK_MS = 33
/** Arrivals this close together are one network delivery: what a stalled
 *  link lets through at once comes as several WebSocket messages, a render
 *  or two apart. Under the server's 100 ms merge window. */
const GROUP_MS = 50
/** …as long as the delivery has not gone on longer than this. */
const MAX_GROUP_SPAN_MS = 150
/** The arrival rate is measured over this long. */
const RATE_WINDOW_MS = 4_000
/** A learned stall fades with this half-life. */
const STALL_HALF_LIFE_MS = 15_000
/** A longer gap is the agent pausing, not the link. */
const MAX_STALL_GAP_MS = 3_000
/** The lag never grows past this. */
const MAX_LAG_MS = 1_500
/** A shorter lag is not worth holding text for. */
const MIN_LAG_MS = 250
/** A release never makes up for more time than this: after an idle spell
 *  (nothing held, so no ticks) the first release must not show it all. */
const MAX_TICK_GAP_MS = 4 * PACER_TICK_MS

// The link's stall is shared by every connection in this window: they all
// come over the same link.
let linkStall = 0
let linkStallAt = 0

function decayedStall(now: number): number {
  if (linkStallAt !== 0 && now > linkStallAt) {
    linkStall *= Math.pow(0.5, (now - linkStallAt) / STALL_HALF_LIFE_MS)
  }
  linkStallAt = now
  return linkStall
}

/** The lag the pacer holds text for now; `0` when it shows text at once. */
export function revealLagMs(now: number): number {
  const lag = Math.min(MAX_LAG_MS, decayedStall(now) * 1.1)
  return lag < MIN_LAG_MS ? 0 : lag
}

/** One stream's pacing (one connection's live turn). */
export class RevealPacer {
  private lastDelivery: number | null = null
  private recent: Array<[number, number]> = []
  private carry = 0
  /** The gap before the delivery now arriving, and what should have arrived
   *  during it — until the delivery has brought enough to call it a stall. */
  private pendingGap: { gap: number; expected: number } | null = null

  private rate(now: number): number {
    while (this.recent.length && this.recent[0]![0] < now - RATE_WINDOW_MS) {
      this.recent.shift()
    }
    const first = this.recent.length ? this.recent[0]![0] : now
    const span = Math.max(1_000, now - first)
    let chars = 0
    for (const [, n] of this.recent) chars += n
    return Math.max(0.02, chars / span)
  }

  /** `chars` characters arrived at `now`. */
  arrived(now: number, chars: number): void {
    const last = this.lastDelivery
    this.lastDelivery = now
    const recentLast = this.recent[this.recent.length - 1]
    if (
      last !== null &&
      recentLast &&
      now - last <= GROUP_MS &&
      now - recentLast[0] <= MAX_GROUP_SPAN_MS
    ) {
      recentLast[1] += chars
    } else {
      // What should have arrived during the gap at the rate so far: a
      // delivery that brings about that much was held up on the way.
      const gap = last === null ? 0 : now - last
      this.pendingGap =
        last !== null && gap < MAX_STALL_GAP_MS
          ? { gap, expected: this.rate(now) * gap }
          : null
      this.recent.push([now, chars])
    }
    const delivered = this.recent[this.recent.length - 1]![1]
    if (this.pendingGap && delivered >= this.pendingGap.expected * 0.5) {
      linkStall = Math.max(decayedStall(now), this.pendingGap.gap)
      this.pendingGap = null
    }
  }

  /** How many of the `backlog` held characters to show now, `dt` ms after
   *  the last release. */
  release(now: number, backlog: number, dt: number): number {
    const lag = revealLagMs(now)
    if (lag === 0 || backlog <= 0) {
      this.carry = 0
      return backlog
    }
    // Nothing for longer than a stall: the next delivery is late or the
    // stream ended. Stop slowing down to bridge the wait, and keep the rate
    // it had — measured up to now it would fall towards zero and leave the
    // last words trickling out.
    const since = this.lastDelivery === null ? 0 : now - this.lastDelivery
    const late = since > lag
    const rate = this.rate(late ? this.lastDelivery! + lag : now)
    const backlogMs = backlog / rate
    const factor = Math.min(
      3,
      Math.max(late ? 1 : 0.25, 1 + (0.8 * (backlogMs - lag)) / lag)
    )
    this.carry += rate * Math.min(MAX_TICK_GAP_MS, Math.max(0, dt)) * factor
    const n = Math.min(backlog, Math.floor(this.carry))
    this.carry -= n
    return n
  }

  /** Everything held was shown at once (a barrier). */
  drained(): void {
    this.carry = 0
  }
}

/**
 * Where to cut `text` to show about `n` of its characters: at the next
 * whitespace if one is within 12 characters, and never inside a surrogate
 * pair.
 */
export function cutAt(text: string, n: number): number {
  if (n >= text.length) return text.length
  if (n <= 0) return 0
  const space = text.slice(n, n + 12).search(/\s/)
  let cut = space >= 0 ? n + space + 1 : n
  if (cut < text.length) {
    const code = text.charCodeAt(cut - 1)
    if (code >= 0xd800 && code <= 0xdbff) cut += 1
  }
  return Math.min(cut, text.length)
}

/** @internal Test-only. */
export function __resetRevealPacerForTests(): void {
  linkStall = 0
  linkStallAt = 0
}
