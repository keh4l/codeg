/**
 * What a composer send does while the agent is replying (fork-only, aligned
 * with T3 Code's `resolveComposerDispatchMode`).
 *
 * - Idle session: an ordinary send.
 * - Running turn: the per-device default ("steer" unless the user picked
 *   "queue"); holding the platform modifier flips it for this one send.
 * - A draft that cannot steer right now (a slash command, the agent compacting
 *   its context, a stop in flight) always queues.
 */

export type FollowUpBehavior = "steer" | "queue"
export type FollowUpAction = "send" | "steer" | "queue"

export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = "steer"

export interface ResolveFollowUpActionInput {
  /** A turn is in flight (prompting / stopping). */
  running: boolean
  /** ⌘ (macOS) / Ctrl held, or the alternate send shortcut was used. */
  alternate: boolean
  behavior: FollowUpBehavior
  /** False when this draft cannot go into the running turn. */
  canSteer: boolean
}

export function resolveFollowUpAction(
  input: ResolveFollowUpActionInput
): FollowUpAction {
  if (!input.running) return "send"
  if (!input.canSteer) return "queue"
  const def = input.behavior
  if (input.alternate) return def === "queue" ? "steer" : "queue"
  return def
}

/** The action the modifier gives (shown in tooltips next to the default). */
export function alternateFollowUpAction(
  behavior: FollowUpBehavior
): Exclude<FollowUpAction, "send"> {
  return behavior === "queue" ? "steer" : "queue"
}

/**
 * Slash commands (`/compact`, `/review` …) replace what the agent is doing
 * when steered into a turn, so they always queue. Only a text-only draft whose
 * first token is `/word` counts; a path like `/usr/bin` followed by more text
 * still looks like a command, which is the safe side (it queues).
 */
export function isSlashCommandDraft(text: string): boolean {
  return /^\/[^\s/]+(?:\s|$)/.test(text.trimStart())
}

export function isFollowUpBehavior(value: unknown): value is FollowUpBehavior {
  return value === "steer" || value === "queue"
}
