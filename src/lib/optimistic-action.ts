// keh4l build: actions that show their result at once.
//
// Over a slow link a button that waits for its request leaves the user
// looking at an unchanged screen for a round trip or more. These actions
// change the screen first and send the request after: `apply` makes the
// change and returns how to take it back, `commit` sends it. When the request
// finally fails, the change is taken back and the user is told (`onError`) —
// unless a newer action with the same key has taken its place, which then
// owns the screen. `undo` itself checks that what is on screen is still this
// action's (a broadcast may have replaced it since).
//
// `commit` is handed `stillWanted()`: false once a newer action with the same
// key has started. Pass it to the call's retries (`CallOptions.retry`) so a
// late retry of an older change cannot land after a newer one.

const latest = new Map<string, symbol>()

export interface OptimisticAction<T> {
  /** Actions on the same thing share a key; a newer one supersedes. */
  key: string
  /** Change the screen now; return how to take the change back. */
  apply: () => (() => void) | void
  /** Send the change. */
  commit: (stillWanted: () => boolean) => Promise<T>
  /** A failure that means the change is already in place (a repeated delete
   *  that finds nothing to delete). */
  isAlreadyDone?: (error: unknown) => boolean
  /** Tell the user, after the change was taken back. */
  onError?: (error: unknown) => void
}

export type OptimisticOutcome<T> =
  | { status: "done"; value: T | undefined }
  | { status: "superseded" }
  | { status: "failed"; error: unknown }

export async function runOptimistic<T>(
  action: OptimisticAction<T>
): Promise<OptimisticOutcome<T>> {
  const token = Symbol(action.key)
  latest.set(action.key, token)
  const stillWanted = () => latest.get(action.key) === token
  const undo = action.apply() ?? undefined
  try {
    const value = await action.commit(stillWanted)
    return { status: "done", value }
  } catch (error) {
    if (action.isAlreadyDone?.(error))
      return { status: "done", value: undefined }
    if (!stillWanted()) return { status: "superseded" }
    try {
      undo?.()
    } finally {
      action.onError?.(error)
    }
    return { status: "failed", error }
  } finally {
    if (stillWanted()) latest.delete(action.key)
  }
}

/** Retries for a call that is safe to repeat: twice, while still wanted. */
export function retryWhile(stillWanted: () => boolean) {
  return { retry: { attempts: 2, stillWanted } }
}
