# Grok ACP Command Cancellation Design

## Background

Grok can ask Codeg's ACP client to run a terminal command that never exits.
The confirmed production reproduction used a shell that ignored `SIGINT` and
`SIGTERM` while repeatedly spawning `sleep` children. Codeg's Stop API returned
success and eagerly marked the database row cancelled, but the in-memory ACP
session remained prompting and rejected the next prompt with
`turn_in_progress`.

The failure is in the shared ACP terminal runtime, not in Grok's prompt logic:

- terminal commands inherit Codeg's process group;
- Unix cleanup calls `kill_tree` once with its default `SIGTERM`;
- `kill_tree` operates on a one-time descendant snapshot, so a surviving parent
  can create new descendants after the snapshot;
- `kill_command` then waits for the direct child without a deadline;
- the connection loop emits `TurnComplete` only after terminal cleanup returns.

The ACP terminal path uses piped stdout and stderr with a null stdin. It does
not use a PTY, so changing the unrelated portable-PTY subsystem would not
address this incident.

## Scope

This change hardens Unix ACP terminal commands on Linux and macOS. It does not
change Windows process management. Windows remains on the existing
`kill_tree` behavior and is an explicit remaining risk.

The change covers:

1. process-group isolation for every Unix ACP terminal command;
2. bounded, escalating cancellation of the isolated process group;
3. non-blocking terminal wait behavior so a wait request cannot prevent Stop;
4. bounded, concurrent cleanup of all terminals owned by a session;
5. guaranteed ACP turn-state convergence after a Cancel request;
6. diagnostic logs that identify the terminal, PID, PGID, signal stage, elapsed
   time, and cleanup outcome without logging command contents.

The change does not:

- modify the general Codeg PTY terminal manager;
- add a configurable maximum runtime for normally running commands;
- redesign the ACP command queue;
- change the Grok CLI package or prompt behavior;
- harden the vendored ACP agent process supervisor;
- deploy, restart, or otherwise modify `codeg-prod`.

## Architecture

### Unix process containment

`TerminalRuntime::configure_command` will arrange for each Unix child to call
`setpgid(0, 0)` after fork and before exec. The direct child's PID therefore
becomes the PGID before user code can create descendants. Direct-exec and
shell-fallback commands both pass through the same configuration path.

`TerminalInstance` will retain the Unix PGID alongside the child handle. Codeg
will signal only the negative PGID belonging to that terminal. Codeg's own
process group and every other ACP terminal remain outside the target group, so
Stop cannot kill unrelated sessions or the server.

If process-group setup fails, `terminal/create` fails instead of launching an
uncontained command. This is safer than silently falling back to shared-group
execution.

### Child observation

No method may hold the child mutex across an unbounded `child.wait().await`.
Both normal `terminal/wait_for_exit` and cancellation will observe the child
through short `try_wait` critical sections plus asynchronous notification or
condition-based polling. This keeps the child handle available to Stop even
when Grok already has a terminal wait request in flight.

Natural exit still drains stdout and stderr readers for the existing 200 ms
grace period before publishing the final exit status.

### Signal escalation

Unix cancellation targets the isolated process group in three bounded stages:

1. send `SIGINT`, then allow 500 ms for a graceful exit;
2. if the group remains, send `SIGTERM`, then allow 1,500 ms;
3. if the group remains, send `SIGKILL`, then allow up to 2,000 ms for the
   direct child to be reaped.

`ESRCH` is treated as an already-exited group. Other signal or wait failures are
recorded and returned as cleanup errors. No individual stage waits forever.

After the direct child is reaped, Codeg verifies that the PGID no longer has
members. If members briefly remain after the direct child exits, the final
`SIGKILL` stage still targets the group rather than only the former parent PID.

### Session cleanup

`release_all_for_session` removes all matching terminals from the runtime map
under a short lock, then cancels them concurrently. Concurrent cancellation
keeps the session deadline independent of terminal count.

The connection-level Cancel path waits at most five seconds for the session
cleanup task. The cleanup task owns the removed terminal instances and remains
detached if this outer deadline expires, so dropping the wait does not abandon
the child handles.

Expected Unix cleanup completes inside four seconds. The extra second is an
outer safety margin for scheduling and reader draining.

## Cancel and state data flow

1. `ConnectionManager::cancel` enqueues `ConnectionCommand::Cancel` and keeps
   the existing eager database transition to `cancelled`.
2. The connection loop sends ACP `CancelNotification` to Grok.
3. It starts session terminal cleanup and waits for either completion or the
   five-second deadline.
4. It clears tracked terminal calls and pending permission requests.
5. It emits `TurnComplete { stop_reason: "cancelled" }` regardless of cleanup
   success, failure, or timeout.
6. `SessionState` clears active tool calls, pending prompt data,
   `turn_in_flight`, and returns to `Connected`.
7. If cleanup failed or exceeded the deadline, Codeg also emits a recoverable
   diagnostic error. The background cleanup continues targeting only that
   terminal's isolated PGID.

This ordering prevents an infinite prompting state while still giving normal
cleanup a bounded opportunity to finish before accepting the next prompt.

## Error handling and observability

Terminal cleanup returns a structured outcome rather than discarding errors.
Logs include:

- connection/session/terminal identifiers;
- direct PID and Unix PGID;
- signal stage and elapsed duration;
- exit signal or exit code;
- cleanup completion, error, or outer timeout;
- whether state convergence was forced after a cleanup problem.

Logs must not include raw command text, environment values, tokens, or terminal
output.

The Cancel API continues to acknowledge queue acceptance. This change does not
redesign its response schema; actual completion remains observable through ACP
events and the session snapshot.

## Tests

All regression tests run only against processes created by the test itself.
They must never signal the Cargo test runner's process group.

### RED tests before implementation

1. A spawned Unix ACP terminal has a PGID different from the test runner and
   equal to its direct child PID.
2. A shell that ignores `SIGINT`/`SIGTERM` and repeatedly creates a child is
   fully terminated by session cleanup within five seconds.
3. Cancelling one stubborn terminal leaves a concurrently running terminal in
   another session alive.
4. An in-flight terminal wait does not prevent cancellation from acquiring the
   child and completing.
5. A cleanup future that exceeds the connection deadline still results in
   `TurnComplete`, `turn_in_flight == false`, no active tool calls, and a state
   that accepts the next prompt.

Tests include explicit emergency cleanup by exact descendant PID snapshot if a
RED test times out, ensuring a deliberately failing pre-fix test cannot leave
processes behind.

### Verification after implementation

- targeted ACP terminal runtime tests;
- targeted connection/session cancellation tests;
- server-mode Rust unit tests relevant to ACP;
- server-mode `cargo clippy` with warnings denied;
- a safe standalone reproduction using the Worktree's debug test binary and a
  temporary directory;
- process-tree verification before and after Stop, including PID/PGID and a
  second unaffected session;
- confirmation that the production `codeg-prod` PID, tmux session, binary, and
  health endpoint remain unchanged.

## Acceptance criteria

- A Unix command that ignores `SIGINT` and `SIGTERM` cannot keep Cancel pending
  beyond the configured deadline.
- The command and all members of its process group are gone after cancellation.
- No process outside the terminal's PGID receives a cancellation signal.
- A terminal wait request cannot lock out Stop.
- The ACP session leaves Prompting, clears `turn_in_flight`, and can accept a
  subsequent prompt after cancellation.
- Existing normal command execution, output capture, shell fallback, working
  directory, and environment propagation tests continue to pass.
- No source, branch, process, or deployment state in the shared `main`
  checkout or `codeg-prod` is changed by implementation or verification.

## Remaining risks

- Windows retains snapshot-based cleanup and can still exhibit a related
  process-tree race; a future change should use a Job Object.
- The vendored ACP agent process itself still lacks independent process-group
  containment and bounded escalation. It was not the process that hung in the
  confirmed reproduction.
- Cancel remains a command on the connection's bounded FIFO. This design fixes
  the confirmed cleanup blockage but does not introduce a separate
  high-priority cancellation channel for unrelated long-running connection
  operations.
- PID/PGID reuse is theoretically possible after a group fully exits. Signals
  are sent only while the tracked direct child is observed as live, and
  `ESRCH` ends escalation, minimizing that window without adding Linux-only
  pidfd behavior that would not cover macOS.
