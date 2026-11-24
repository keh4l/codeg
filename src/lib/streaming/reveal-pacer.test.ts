import { beforeEach, describe, expect, it } from "vitest"

import {
  PACER_TICK_MS,
  RevealPacer,
  __resetRevealPacerForTests,
  cutAt,
  revealLagMs,
} from "./reveal-pacer"

beforeEach(() => __resetRevealPacerForTests())

/** A steady model (`charsPerSec`) behind a link that delivers what piled up
 *  every `everyMs`. Returns when each character became visible. */
function play(charsPerSec: number, everyMs: number, seconds: number) {
  const pacer = new RevealPacer()
  const arrivals: number[] = [] // time each character arrived
  const shownAt: number[] = []
  let produced = 0
  let held = 0
  let last = 0
  for (let t = 0; t <= seconds * 1000 + 3000; t += 1) {
    if (t <= seconds * 1000 && t % everyMs === 0 && t > 0) {
      const now = Math.floor((t / 1000) * charsPerSec)
      const n = now - produced
      produced = now
      if (n > 0) {
        pacer.arrived(t, n)
        for (let i = 0; i < n; i++) arrivals.push(t)
        held += n
      }
    }
    if (t % PACER_TICK_MS === 0 && held > 0) {
      const n = pacer.release(t, held, t - last)
      last = t
      for (let i = 0; i < n; i++) shownAt.push(t)
      held -= n
    }
  }
  return { arrivals, shownAt }
}

function longestStill(shownAt: number[], from: number, to: number) {
  let longest = 0
  let prev = from
  for (const t of shownAt) {
    if (t < from || t > to) continue
    longest = Math.max(longest, t - prev)
    prev = t
  }
  return longest
}

describe("RevealPacer", () => {
  it("shows a smooth stream as it arrives", () => {
    const { arrivals, shownAt } = play(60, 50, 10)
    expect(revealLagMs(10_000)).toBe(0)
    shownAt.forEach((t, i) => expect(t - arrivals[i]!).toBeLessThan(40))
  })

  it("evens out a stream that arrives in bursts", () => {
    const { arrivals, shownAt } = play(60, 800, 20)
    // Settled (past the first stalls): text keeps growing instead of jumping
    // every 0.8 s, and stays within the lag cap behind its arrival.
    expect(longestStill(shownAt, 5_000, 19_000)).toBeLessThan(300)
    shownAt.forEach((t, i) => expect(t - arrivals[i]!).toBeLessThan(2_000))
    expect(shownAt.length).toBe(arrivals.length)
  })

  it("does not make up for an idle spell all at once", () => {
    const pacer = new RevealPacer()
    for (let t = 800; t <= 4_000; t += 800) pacer.arrived(t, 48)
    expect(revealLagMs(4_000)).toBeGreaterThan(0)
    // Nothing was held since the last release long ago: the first release
    // of a new burst shows a slice of it, not the whole.
    expect(pacer.release(4_033, 48, 3_000)).toBeLessThan(12)
  })

  it("does not take a model's pause for a bursty link", () => {
    const pacer = new RevealPacer()
    for (let t = 0; t < 5_000; t += 50) pacer.arrived(t, 3)
    // A 2 s pause, then the model goes on at its own pace.
    pacer.arrived(7_000, 3)
    expect(revealLagMs(7_000)).toBe(0)
    // A 0.8 s stall that delivers what piled up meanwhile is the link.
    pacer.arrived(7_800, 48)
    expect(revealLagMs(7_800)).toBeGreaterThan(0)
  })

  it("counts a stall whose text comes as several messages at once", () => {
    const pacer = new RevealPacer()
    // 250 chars/s in a message every 100 ms (the server's merge window).
    for (let t = 0; t <= 4_000; t += 100) pacer.arrived(t, 25)
    // A lost packet: nothing for 0.7 s, then the seven messages it held up,
    // a few ms apart.
    for (let i = 0; i < 7; i++) pacer.arrived(4_700 + i * 3, 25)
    expect(revealLagMs(4_720)).toBeGreaterThan(700)
  })

  it("forgets a stall as the link stays smooth", () => {
    const pacer = new RevealPacer()
    for (let t = 0; t < 4_000; t += 50) pacer.arrived(t, 3)
    pacer.arrived(4_900, 60)
    expect(revealLagMs(4_900)).toBeGreaterThan(0)
    expect(revealLagMs(4_900 + 60_000)).toBe(0)
  })
})

describe("cutAt", () => {
  it("cuts at the next space within reach", () => {
    expect(cutAt("hello world again", 3)).toBe(6)
    expect(cutAt("abcdefghijklmnopqrstuvwxyz", 3)).toBe(3)
    expect(cutAt("short", 10)).toBe(5)
  })

  it("never splits a surrogate pair", () => {
    const text = "ab😀cdefghijklmnopqrstu"
    expect(cutAt(text, 3)).toBe(4)
  })
})
