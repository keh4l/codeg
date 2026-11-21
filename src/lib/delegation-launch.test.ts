import { describe, expect, it } from "vitest"

import {
  continuationRoundOf,
  hasLaunchDetail,
  launchChipLabel,
  parseDelegationLaunch,
} from "./delegation-launch"
import { normalizeToolName } from "./tool-call-normalization"

describe("delegation launch facts", () => {
  it("reads the call's own model, options and isolation", () => {
    const facts = parseDelegationLaunch(
      JSON.stringify({
        agent_type: "codex",
        task: "x",
        isolation: "worktree",
        model: "gpt-6.2",
        config: { reasoning_effort: "high" },
      }),
      null
    )
    expect(facts).toMatchObject({
      model: "gpt-6.2",
      config: { reasoning_effort: "high" },
      isolation: "worktree",
      worktree: null,
      round: null,
    })
    expect(launchChipLabel(facts)).toBe("gpt-6.2 · high")
    expect(hasLaunchDetail(facts)).toBe(true)
  })

  it("takes the worktree and round from the broker's meta", () => {
    const facts = parseDelegationLaunch(JSON.stringify({ task: "x" }), {
      "codeg.delegation": {
        status: "running",
        worktree: {
          path: "/w/proj-delegate-9f3a1c22",
          branch: "delegate/9f3a1c22",
          base_sha: "abcdef0123",
        },
        round: 2,
      },
    })
    expect(facts.isolation).toBe("worktree")
    expect(facts.worktree?.branch).toBe("delegate/9f3a1c22")
    expect(facts.round).toBe(2)
    expect(launchChipLabel(facts)).toBeNull()
  })

  it("reads a continuation's round off its ack", () => {
    const facts = parseDelegationLaunch(
      JSON.stringify({ task_id: "a", task: "more" }),
      null,
      "Continuation started. task_id=b — round 3 of task a, in the same sub-agent session."
    )
    expect(facts.round).toBe(3)
    expect(hasLaunchDetail(facts)).toBe(false)
  })

  it("draws continue_delegation on the delegation card", () => {
    expect(normalizeToolName("mcp__codeg-mcp__continue_delegation")).toBe(
      "delegate_to_agent"
    )
    expect(normalizeToolName("continue_delegation")).toBe("delegate_to_agent")
  })
})

describe("continuation prompts", () => {
  it("reads the round off the prompt a continued sub-agent got", () => {
    expect(
      continuationRoundOf(
        "Follow-up from the agent that delegated this task to you (round 3). Continue in this session, with everything you did so far:\n\nfix it"
      )
    ).toBe(3)
    expect(continuationRoundOf("Follow-up (round 3).")).toBeNull()
    expect(continuationRoundOf("please fix the test")).toBeNull()
  })
})
