import { describe, expect, it } from "vitest"
import { isConnectionBusy } from "@/lib/connection-teardown"
import type { AsyncTaskRecord } from "@/lib/types"

// Releasing a connection no view holds (a parked one past its budget, the
// idle sweep) must not kill an owner whose agent still has work in flight:
// disconnecting kills the agent CLI, and any launched background tasks with
// it. Busy owners are reclaimed by the idle sweeps — which exempt them only
// while that work is live — so once the work settles the connection becomes
// sweep-eligible again through the SAME predicate flipping on the next pass.
// (Tab unmounts no longer disconnect at all: they park, see
// `parkConnection`.)

/** An idle owner between turns: nothing in flight on any channel. */
const IDLE_OWNER = {
  status: "connected",
  backgroundOutstanding: 0,
  asyncTasks: [] as AsyncTaskRecord[],
  remoteControl: null,
  delegatedChildren: [] as string[],
}

function asyncTask(state: string): AsyncTaskRecord {
  return {
    task_id: "call_bg_1",
    name: "npm run dev",
    task_type: "shell",
    description: "",
    show_in_transcript: false,
    can_stop: true,
    state,
  }
}

describe("isConnectionBusy", () => {
  it("keeps an owner alive while background work is outstanding", () => {
    expect(!isConnectionBusy({ ...IDLE_OWNER, backgroundOutstanding: 2 })).toBe(
      false
    )
  })

  it("keeps a prompting owner alive (existing behavior)", () => {
    expect(!isConnectionBusy({ ...IDLE_OWNER, status: "prompting" })).toBe(
      false
    )
  })

  // The AIR half of the rule: a codex background terminal or a Claude Monitor
  // task is announced on the async-task channel only, so the watcher's count
  // stays 0 while it runs.
  it("keeps an owner alive while an async task is running or paused", () => {
    for (const state of ["running", "paused"]) {
      expect(
        !isConnectionBusy({
          ...IDLE_OWNER,
          asyncTasks: [asyncTask(state)],
        })
      ).toBe(false)
    }
  })

  it("disconnects an owner whose async tasks have all settled", () => {
    expect(
      !isConnectionBusy({
        ...IDLE_OWNER,
        asyncTasks: ["completed", "failed", "stopped"].map(asyncTask),
      })
    ).toBe(true)
  })

  // Remote Control runs in the agent CLI; the user handed the session to
  // claude.ai/code or a phone, so closing the tab must not end it there.
  it("keeps an owner alive while Remote Control is on", () => {
    expect(
      !isConnectionBusy({
        ...IDLE_OWNER,
        remoteControl: { session_url: null },
      })
    ).toBe(false)
  })

  // A codeg delegation outlives the turn that started it, and ending the
  // parent cancels every sub-agent it still has running.
  it("keeps an owner alive while a delegated sub-agent is running", () => {
    expect(
      !isConnectionBusy({
        ...IDLE_OWNER,
        delegatedChildren: ["child-conn"],
      })
    ).toBe(false)
  })

  it("disconnects an idle owner once outstanding has settled to zero", () => {
    expect(!isConnectionBusy(IDLE_OWNER)).toBe(true)
  })
})
