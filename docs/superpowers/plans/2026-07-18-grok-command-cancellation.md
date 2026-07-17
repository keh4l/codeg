# Grok Unix Command Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a Unix ACP terminal command that ignores graceful signals cannot keep Codeg's Cancel path blocked or leave the session permanently prompting.

**Architecture:** Every Unix ACP terminal command is spawned in a process group whose PGID equals its direct child PID. A generation-tagged process-group lease owns that numeric PGID only while the leader is alive or during a non-renewable five-second descendant deadline; an injectable backend serializes probes, signals, and permanent retirement under the lease lock. Terminal cancellation signals a valid lease with bounded `SIGINT`/`SIGTERM`/`SIGKILL` escalation while child observation uses short `try_wait` critical sections; session cleanup runs terminal cancellations concurrently, and the connection layer applies a five-second outer deadline before unconditionally emitting `TurnComplete`.

**Tech Stack:** Rust 2021, Tokio process/runtime APIs, libc Unix signals, futures `join_all`, SACP terminal protocol, existing `SessionState`/`EventEmitter`, Cargo unit tests and Clippy.

## Global Constraints

- Implement only for Unix (`cfg(unix)`): Linux and macOS receive the new process-group behavior; Windows keeps the existing `kill_tree` fallback and remains an explicit risk.
- Do not modify the unrelated portable-PTY terminal manager.
- Do not add a normal-command maximum runtime; only cancellation is bounded.
- Use exact signal grace periods: `SIGINT` 500 ms, `SIGTERM` 1,500 ms, `SIGKILL` 2,000 ms.
- Use an exact connection-level cleanup deadline of 5 seconds.
- Use an exact, non-renewable descendant lease of 5 seconds from observed direct-child exit; expiry retires without a final probe or signal.
- Every Unix process-group lease has a monotonically unique internal generation.
- Serialize lease state, probes, signals, and retirement with the same per-terminal state lock; the cleanup gate permits only one escalation sequence without holding the state lock across waits. Every `OwnedDescendants` signal stage must probe then signal under that state lock; a probe `ESRCH` retires before the signal.
- Treat `ESRCH` as an already-exited process group; return other signal/query failures as structured cleanup failures.
- POSIX cannot atomically bind a probe and signal to one process-group generation. The fix removes the unbounded stale-PGID interval; the remaining risk is limited to the valid five-second descendant lease and the immediate probe-to-signal syscall race.
- Never signal Codeg's process group, the Cargo test runner's process group, another ACP session, or a system process.
- Logs may include connection/session/terminal IDs, PID, PGID, signal stage, elapsed time, exit code/signal, and outcome; they must not include command text, environment values, tokens, or terminal output.
- Keep the Cancel API response schema unchanged.
- Make no changes in `/www/gitroot/codeg`, do not push, deploy, restart `codeg-prod`, or modify production data.

---

## File map

- Modify `src-tauri/src/acp/terminal_runtime.rs`: Unix process-group containment, generation/deadline lease state, injectable group backend, non-blocking child observation, staged group termination, structured/concurrent session cleanup, mock lease tests, and OS-process regression tests.
- Modify `src-tauri/src/acp/connection.rs`: five-second outer cleanup deadline, detached cleanup ownership after timeout, recoverable diagnostic event, unconditional cancelled `TurnComplete`, and state-convergence regression test.
- Do not modify `src-tauri/src/acp/session_state.rs`: its existing `TurnComplete` reducer already clears `turn_in_flight`, active tool calls, pending prompt/permission/question state, and sets `Connected`; the connection test exercises this existing behavior through `emit_with_state`.
- Do not modify `src-tauri/src/acp/manager.rs`: its existing prompt admission gate reads `turn_in_flight`; clearing that flag through `TurnComplete` restores prompt admission.

---

### Task 1: Add safe Unix RED regression coverage

**Files:**
- Modify: `src-tauri/src/acp/terminal_runtime.rs:673-1030`
- Test: `src-tauri/src/acp/terminal_runtime.rs` inline `#[cfg(all(test, unix))]` module

**Interfaces:**
- Consumes: existing `TerminalRuntime::create_terminal`, `TerminalRuntime::wait_for_terminal_exit`, `TerminalRuntime::release_all_for_session`, private `TerminalRuntime::find_terminal`, and private `TerminalInstance::child`.
- Produces: three named regression tests and test-only helpers that later tasks must make green without weakening their assertions.

- [ ] **Step 1: Add exact-PID emergency cleanup helpers**

Add these imports and helpers inside the existing Unix test module. `emergency_kill_exact_tree` first stops the exact test-owned parent so it cannot spawn another child between tree discovery and `SIGKILL`; it never uses a negative PID or a process-group signal.

```rust
use std::time::Instant;

use kill_tree::Config;

fn init_test_tracing() {
    let _ = tracing_subscriber::fmt().with_test_writer().try_init();
}

async fn terminal_pid(runtime: &TerminalRuntime, session_id: &SessionId, terminal_id: &str) -> u32 {
    let terminal = runtime
        .find_terminal(terminal_id, session_id.0.as_ref())
        .await
        .expect("test terminal exists");
    terminal
        .child
        .lock()
        .await
        .as_ref()
        .and_then(tokio::process::Child::id)
        .expect("test terminal has a direct child pid")
}

fn pid_exists(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

async fn emergency_kill_exact_tree(pid: u32, terminal: &Arc<TerminalInstance>) {
    let pid = pid as libc::pid_t;
    let _ = unsafe { libc::kill(pid, libc::SIGSTOP) };
    let config = Config {
        signal: "SIGKILL".to_string(),
        include_target: true,
    };
    let _ = kill_tree::tokio::kill_tree_with_config(pid as u32, &config).await;
    let _ = unsafe { libc::kill(pid, libc::SIGKILL) };
    let _ = tokio::time::timeout(Duration::from_secs(1), terminal.wait_for_exit()).await;
    for _ in 0..100 {
        if !pid_exists(pid as u32) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn spawn_shell(
    runtime: &TerminalRuntime,
    session_id: &SessionId,
    script: &str,
) -> (String, u32) {
    let mut request =
        CreateTerminalRequest::new(session_id.clone(), "/bin/sh".to_string());
    request.args = vec!["-c".into(), script.into()];
    let response = runtime
        .create_terminal(request)
        .await
        .expect("create test terminal");
    let terminal_id = response.terminal_id.to_string();
    let pid = terminal_pid(runtime, session_id, &terminal_id).await;
    (terminal_id, pid)
}
```

- [ ] **Step 2: Add the process-group isolation regression test**

```rust
#[tokio::test]
async fn unix_terminal_isolated_in_own_process_group() {
    init_test_tracing();
    let runtime = TerminalRuntime::with_base_env(BTreeMap::new());
    let session_id = SessionId::new("pgid-isolation".to_string());
    let (_terminal_id, pid) = spawn_shell(&runtime, &session_id, "sleep 60").await;

    let child_pgid = unsafe { libc::getpgid(pid as libc::pid_t) };
    let runner_pgid = unsafe { libc::getpgrp() };
    let _ = runtime.release_all_for_session(session_id.0.as_ref()).await;

    assert_eq!(child_pgid, pid as libc::pid_t, "child must lead its own process group");
    assert_ne!(child_pgid, runner_pgid, "child must not share the test runner process group");
}
```

- [ ] **Step 3: Run the isolation test and record the behavioral RED failure**

Run:

```bash
cd /www/gitroot/codeg-worktrees/issue-grok-command-hang/src-tauri
cargo test --no-default-features acp::terminal_runtime::tests::unix_terminal_isolated_in_own_process_group --lib -- --nocapture
```

Expected: FAIL at `assert_eq!(child_pgid, pid)` because the child inherits the Cargo test runner's PGID. The test performs session cleanup before asserting; confirm the log's printed test-owned PID is absent with `ps -eo pid,ppid,pgid,state,command | rg 'pgid-isolation|sleep 60'`.

- [ ] **Step 4: Add the stubborn-tree and cross-session isolation regression test**

```rust
#[tokio::test]
async fn session_cleanup_kills_stubborn_group_without_touching_other_session() {
    init_test_tracing();
    let runtime = TerminalRuntime::with_base_env(BTreeMap::new());
    let victim_session = SessionId::new("stubborn-victim".to_string());
    let other_session = SessionId::new("unrelated-session".to_string());
    let (victim_terminal_id, victim_pid) = spawn_shell(
        &runtime,
        &victim_session,
        "trap '' INT TERM; while :; do sleep 60 & wait $!; done",
    )
    .await;
    let victim_terminal = runtime
        .find_terminal(&victim_terminal_id, victim_session.0.as_ref())
        .await
        .expect("victim terminal exists");
    let (_other_terminal, other_pid) =
        spawn_shell(&runtime, &other_session, "while :; do sleep 60; done").await;

    let started = Instant::now();
    let cleanup = tokio::time::timeout(
        Duration::from_secs(5),
        runtime.release_all_for_session(victim_session.0.as_ref()),
    )
    .await;

    if cleanup.is_err() {
        emergency_kill_exact_tree(victim_pid, &victim_terminal).await;
    }
    let other_still_alive = pid_exists(other_pid);
    let _ = runtime
        .release_all_for_session(other_session.0.as_ref())
        .await;

    assert!(cleanup.is_ok(), "stubborn terminal cleanup exceeded five seconds");
    assert!(!pid_exists(victim_pid), "victim direct child survived cleanup");
    assert!(other_still_alive, "cleanup signalled a terminal from another session");
    assert!(started.elapsed() < Duration::from_secs(5));
}
```

- [ ] **Step 5: Add the in-flight wait lockout regression test**

```rust
#[tokio::test]
async fn in_flight_wait_does_not_block_session_cleanup() {
    init_test_tracing();
    let runtime = Arc::new(TerminalRuntime::with_base_env(BTreeMap::new()));
    let session_id = SessionId::new("wait-does-not-lock-cancel".to_string());
    let (terminal_id, pid) = spawn_shell(&runtime, &session_id, "sleep 60").await;
    let terminal = runtime
        .find_terminal(&terminal_id, session_id.0.as_ref())
        .await
        .expect("terminal exists");

    let waiter_runtime = Arc::clone(&runtime);
    let waiter_session = session_id.clone();
    let waiter_terminal = terminal_id.clone();
    let wait_task = tokio::spawn(async move {
        waiter_runtime
            .wait_for_terminal_exit(WaitForTerminalExitRequest::new(
                waiter_session,
                waiter_terminal.into(),
            ))
            .await
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    let cleanup = tokio::time::timeout(
        Duration::from_secs(5),
        runtime.release_all_for_session(session_id.0.as_ref()),
    )
    .await;
    if cleanup.is_err() {
        emergency_kill_exact_tree(pid, &terminal).await;
    }
    let wait_result = tokio::time::timeout(Duration::from_secs(1), wait_task).await;

    assert!(cleanup.is_ok(), "terminal wait held the child mutex across cancellation");
    assert!(wait_result.is_ok(), "terminal wait did not observe cancellation exit");
}
```

- [ ] **Step 6: Run both hang regressions and verify safe RED cleanup**

Run each test separately so a failure cannot obscure its emergency cleanup:

```bash
cargo test --no-default-features acp::terminal_runtime::tests::session_cleanup_kills_stubborn_group_without_touching_other_session --lib -- --nocapture
cargo test --no-default-features acp::terminal_runtime::tests::in_flight_wait_does_not_block_session_cleanup --lib -- --nocapture
```

Expected before implementation:

- stubborn cleanup: FAIL with `stubborn terminal cleanup exceeded five seconds` after the exact-PID emergency cleanup runs;
- in-flight wait: FAIL with `terminal wait held the child mutex across cancellation` under the current `child.wait().await` mutex hold.

After each failure, run `ps -eo pid,ppid,pgid,state,command | rg 'stubborn-victim|wait-does-not-lock-cancel|trap .*INT TERM|sleep 60'`; expected: no remaining process tied to the completed test binary. The emergency path signals and reaps only the direct PID retained by the test.

---

### Task 2: Isolate Unix command groups and remove the child-wait mutex blockage

**Files:**
- Modify: `src-tauri/src/acp/terminal_runtime.rs:1-214,267-405`
- Test: `src-tauri/src/acp/terminal_runtime.rs` tests added in Task 1

**Interfaces:**
- Consumes: Tokio `Command::process_group(0)`, `Child::id`, existing `refresh_exit_status`, `drain_readers`, and `TerminalSnapshot`.
- Produces: `TerminalInstance::{terminal_id,pid,pgid}`, polling `wait_for_exit`, and Unix group-query/signal helpers used by Task 3.

- [ ] **Step 1: Add exact timing constants and terminal identity fields**

Add these constants beside `READER_DRAIN_GRACE`:

```rust
const CHILD_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);
#[cfg(unix)]
const SIGINT_GRACE: Duration = Duration::from_millis(500);
#[cfg(unix)]
const SIGTERM_GRACE: Duration = Duration::from_millis(1_500);
#[cfg(unix)]
const SIGKILL_GRACE: Duration = Duration::from_millis(2_000);
```

Extend `TerminalInstance` and its constructor without recording command text:

```rust
struct TerminalInstance {
    terminal_id: String,
    session_id: String,
    pid: u32,
    #[cfg(unix)]
    pgid: libc::pid_t,
    output_limit: Option<usize>,
    child: Mutex<Option<tokio::process::Child>>,
    snapshot: Mutex<TerminalSnapshot>,
    reader_handles: Mutex<Vec<JoinHandle<()>>>,
}

impl TerminalInstance {
    fn new(
        terminal_id: String,
        session_id: String,
        output_limit: Option<u64>,
        child: tokio::process::Child,
        pid: u32,
    ) -> Result<Self, TerminalRuntimeError> {
        #[cfg(unix)]
        let pgid = libc::pid_t::try_from(pid).map_err(|_| {
            TerminalRuntimeError::Internal(format!("terminal pid {pid} does not fit pid_t"))
        })?;
        Ok(Self {
            terminal_id,
            session_id,
            pid,
            #[cfg(unix)]
            pgid,
            output_limit: output_limit.and_then(|v| usize::try_from(v).ok()),
            child: Mutex::new(Some(child)),
            snapshot: Mutex::new(TerminalSnapshot::default()),
            reader_handles: Mutex::new(Vec::new()),
        })
    }
```

- [ ] **Step 2: Put direct and shell-fallback commands in their own Unix process group**

At the end of `configure_command`, after stdio/cwd/env setup, add:

```rust
#[cfg(unix)]
{
    // A PGID of zero asks the child to become the leader of a new group whose
    // PGID equals its PID. Spawn fails if the OS cannot establish containment.
    command.process_group(0);
}
```

In `create_terminal`, obtain the child PID immediately after spawn and pass the generated terminal ID into the constructor:

```rust
let pid = child.id().ok_or_else(|| {
    TerminalRuntimeError::Internal("spawned terminal has no process id".to_string())
})?;
let stdout = child.stdout.take();
let stderr = child.stderr.take();

let terminal_id = format!("term_{}", uuid::Uuid::new_v4().simple());
let terminal = Arc::new(TerminalInstance::new(
    terminal_id.clone(),
    request.session_id.to_string(),
    Some(output_byte_limit),
    child,
    pid,
)?);
```

Add a spawn log with identifiers only:

```rust
#[cfg(unix)]
tracing::info!(
    terminal_id = %terminal_id,
    session_id = %request.session_id,
    pid,
    pgid = pid,
    "[ACP] spawned isolated terminal process group"
);
```

- [ ] **Step 3: Replace the unbounded locked `child.wait()` with condition polling**

Replace `TerminalInstance::wait_for_exit` with:

```rust
async fn wait_for_exit(&self) -> Result<TerminalExitStatus, TerminalRuntimeError> {
    loop {
        self.refresh_exit_status().await?;
        if let Some(exit_status) = self.snapshot.lock().await.exit_status.clone() {
            return Ok(exit_status);
        }
        tokio::time::sleep(CHILD_EXIT_POLL_INTERVAL).await;
    }
}
```

This preserves an unbounded normal wait, as the ACP method requires, but never holds `self.child` across an `.await` other than the bounded mutex acquisition itself.

- [ ] **Step 4: Add Unix process-group query and signal helpers**

Add these private helpers on `TerminalInstance`:

```rust
#[cfg(unix)]
fn process_group_exists(&self) -> Result<bool, TerminalRuntimeError> {
    let result = unsafe { libc::kill(-self.pgid, 0) };
    if result == 0 {
        return Ok(true);
    }
    let err = std::io::Error::last_os_error();
    match err.raw_os_error() {
        Some(libc::ESRCH) => Ok(false),
        Some(libc::EPERM) => Ok(true),
        _ => Err(TerminalRuntimeError::Internal(format!(
            "failed to query terminal process group pgid={}: {}",
            self.pgid,
            err
        ))),
    }
}

#[cfg(unix)]
fn signal_process_group(
    &self,
    signal: libc::c_int,
    stage: &'static str,
) -> Result<(), TerminalRuntimeError> {
    let result = unsafe { libc::kill(-self.pgid, signal) };
    if result == 0 {
        tracing::info!(
            terminal_id = %self.terminal_id,
            session_id = %self.session_id,
            pid = self.pid,
            pgid = self.pgid,
            signal_stage = stage,
            "[ACP] signalled terminal process group"
        );
        return Ok(());
    }
    let err = std::io::Error::last_os_error();
    if err.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    Err(TerminalRuntimeError::Internal(format!(
        "failed to signal terminal process group pgid={} stage={stage}: {err}",
        self.pgid
    )))
}

#[cfg(unix)]
async fn wait_for_process_group_exit(
    &self,
    grace: Duration,
) -> Result<bool, TerminalRuntimeError> {
    let deadline = tokio::time::Instant::now() + grace;
    loop {
        self.refresh_exit_status().await?;
        if !self.process_group_exists()? {
            return Ok(true);
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(CHILD_EXIT_POLL_INTERVAL).await;
    }
}
```

- [ ] **Step 5: Run the isolation and wait-lock tests**

Run:

```bash
cargo test --no-default-features acp::terminal_runtime::tests::unix_terminal_isolated_in_own_process_group --lib -- --nocapture
cargo test --no-default-features acp::terminal_runtime::tests::in_flight_wait_does_not_block_session_cleanup --lib -- --nocapture
```

Expected at this intermediate point:

- PGID assertions pass;
- the wait-lock test passes because the concurrent waiter no longer owns the child mutex while sleeping; the current one-shot `SIGTERM` behavior is sufficient for this non-stubborn `sleep` case.

---

### Task 3: Add bounded Unix escalation and concurrent structured session cleanup

**Files:**
- Modify: `src-tauri/src/acp/terminal_runtime.rs:143-208,472-534`
- Test: `src-tauri/src/acp/terminal_runtime.rs` tests added in Task 1

**Interfaces:**
- Consumes: `TerminalInstance::{process_group_exists,signal_process_group,wait_for_process_group_exit}`, exact signal constants, and existing `kill_tree` for non-Unix only.
- Produces: `pub(crate) TerminalCleanupReport`, `TerminalCleanupReport::{is_clean,failure_count}`, bounded Unix `kill_command`, and concurrent `pub(crate) release_all_for_session(&self, session_id: &str) -> TerminalCleanupReport` used by Task 4.

- [ ] **Step 1: Add the structured cleanup report**

Add these types after `TerminalRuntimeError`:

```rust
#[derive(Debug, Default)]
pub(crate) struct TerminalCleanupReport {
    failures: Vec<(String, String)>,
}

impl TerminalCleanupReport {
    pub(crate) fn is_clean(&self) -> bool {
        self.failures.is_empty()
    }

    pub(crate) fn failure_count(&self) -> usize {
        self.failures.len()
    }
}
```

- [ ] **Step 2: Implement bounded Unix group escalation**

Replace the Unix `kill_command` path with the following. If a non-`ESRCH` signal/query failure occurs, preserve it as the returned error but continue through later stages so cleanup remains best-effort. The method succeeds only after the group is gone and the direct child has been reaped into the snapshot.

```rust
#[cfg(unix)]
async fn kill_command(&self) -> Result<(), TerminalRuntimeError> {
    let started = std::time::Instant::now();
    self.refresh_exit_status().await?;
    if !self.process_group_exists()? {
        return Ok(());
    }

    let stages = [
        (libc::SIGINT, "sigint", SIGINT_GRACE),
        (libc::SIGTERM, "sigterm", SIGTERM_GRACE),
        (libc::SIGKILL, "sigkill", SIGKILL_GRACE),
    ];
    let mut first_error = None;

    for (signal, name, grace) in stages {
        if let Err(err) = self.signal_process_group(signal, name) {
            tracing::warn!(
                terminal_id = %self.terminal_id,
                session_id = %self.session_id,
                pid = self.pid,
                pgid = self.pgid,
                signal_stage = name,
                error = %format_args!("{err:?}"),
                "[ACP] terminal process-group signal failed"
            );
            if first_error.is_none() {
                first_error = Some(err);
            }
        }
        match self.wait_for_process_group_exit(grace).await {
            Ok(true) => {
                let exit_status = self.snapshot.lock().await.exit_status.clone();
                tracing::info!(
                    terminal_id = %self.terminal_id,
                    session_id = %self.session_id,
                    pid = self.pid,
                    pgid = self.pgid,
                    elapsed_ms = started.elapsed().as_millis(),
                    signal_stage = name,
                    ?exit_status,
                    "[ACP] terminal process group exited"
                );
                return first_error.map_or(Ok(()), Err);
            }
            Ok(false) => {}
            Err(err) => {
                if first_error.is_none() {
                    first_error = Some(err);
                }
            }
        }
    }

    if self.process_group_exists()? {
        return Err(first_error.unwrap_or_else(|| {
            TerminalRuntimeError::Internal(format!(
                "terminal process group pgid={} survived SIGKILL deadline",
                self.pgid
            ))
        }));
    }
    first_error.map_or(Ok(()), Err)
}
```

Keep an explicitly non-Unix fallback that also avoids holding the child mutex while waiting:

```rust
#[cfg(not(unix))]
async fn kill_command(&self) -> Result<(), TerminalRuntimeError> {
    self.refresh_exit_status().await?;
    if self.snapshot.lock().await.exit_status.is_some() {
        return Ok(());
    }
    let pid = self
        .child
        .lock()
        .await
        .as_ref()
        .and_then(tokio::process::Child::id);
    if let Some(pid) = pid {
        kill_tree::tokio::kill_tree(pid).await.map_err(|err| {
            TerminalRuntimeError::Internal(format!("kill_tree failed for pid {pid}: {err}"))
        })?;
    }
    self.wait_for_exit().await.map(|_| ())
}
```

- [ ] **Step 3: Make all session terminals clean up concurrently**

Replace `release_all_for_session` with:

```rust
pub(crate) async fn release_all_for_session(&self, session_id: &str) -> TerminalCleanupReport {
    let removed = {
        let mut terminals = self.terminals.lock().await;
        let ids: Vec<String> = terminals
            .iter()
            .filter(|(_, term)| term.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter()
            .filter_map(|id| terminals.remove(&id))
            .collect::<Vec<_>>()
    };

    let results = futures::future::join_all(removed.into_iter().map(|terminal| async move {
        let terminal_id = terminal.terminal_id.clone();
        (terminal_id, terminal.kill_command().await)
    }))
    .await;

    let failures = results
        .into_iter()
        .filter_map(|(terminal_id, result)| {
            result.err().map(|err| {
                tracing::error!(
                    terminal_id = %terminal_id,
                    session_id,
                    error = %format_args!("{err:?}"),
                    "[ACP] terminal session cleanup failed"
                );
                (terminal_id, format!("{err:?}"))
            })
        })
        .collect();

    TerminalCleanupReport { failures }
}
```

The failure tuples retain terminal identity and error text for structured diagnostics; do not serialize them into the Cancel API.

- [ ] **Step 4: Update existing cleanup call sites to explicitly ignore reports where no state decision depends on them**

For existing terminal-runtime tests and non-Cancel teardown sites in `connection.rs`, use:

```rust
let _ = terminal_runtime.release_all_for_session(&sid).await;
```

Do not add `unwrap()` or panic on disconnect cleanup. Task 4 handles the active Cancel path separately.

- [ ] **Step 5: Run all Unix terminal-runtime tests**

Run:

```bash
cargo test --no-default-features acp::terminal_runtime::tests --lib -- --nocapture
```

Expected: all existing tests plus the three new regressions PASS. The stubborn test should log `sigint`, `sigterm`, then `sigkill`, complete in under five seconds, leave the other session alive until its own cleanup, and leave no test-owned PID behind.

- [ ] **Step 6: Commit the terminal-runtime TDD slice**

```bash
git add src-tauri/src/acp/terminal_runtime.rs
git commit -m "fix: bound Unix ACP terminal cancellation"
```

---

### Task 4: Guarantee connection cancellation state convergence

**Files:**
- Modify: `src-tauri/src/acp/connection.rs:1-50,4518-4570,5960-end`
- Test: `src-tauri/src/acp/connection.rs` inline `#[cfg(test)]` module

**Interfaces:**
- Consumes: `TerminalCleanupReport::{is_clean,failure_count}`, `emit_with_state`, `AcpEvent::{Error,TurnComplete}`, and the existing `SessionState::apply_event(TurnComplete)` reducer.
- Produces: `CancelCleanupOutcome`, `finish_cancelled_turn_after_cleanup`, an exact five-second production deadline, and a timeout regression test proving state convergence while the cleanup task remains alive.

- [ ] **Step 1: Add cleanup deadline, outcome type, and imports**

Add imports:

```rust
use std::future::Future;
use std::time::Duration;
```

Extend the terminal-runtime import and add the deadline beside other connection constants:

```rust
use crate::acp::terminal_runtime::{
    TerminalCleanupReport, TerminalRuntime, TerminalRuntimeError,
};

const CANCEL_TERMINAL_CLEANUP_DEADLINE: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CancelCleanupOutcome {
    Completed,
    Failed(usize),
    TimedOut,
    TaskFailed,
}
```

- [ ] **Step 2: Write the failing state-convergence timeout test before adding the helper or changing the Cancel branch**

Add this test to the existing `connection.rs` test module:

```rust
#[tokio::test]
async fn terminal_cleanup_timeout_still_completes_cancelled_turn() {
    let mut initial = SessionState::new(
        "cancel-timeout-conn".to_string(),
        AgentType::Grok,
        None,
        "test-window".to_string(),
        None,
    );
    initial.status = ConnectionStatus::Prompting;
    initial.turn_in_flight = true;
    initial.apply_event(&AcpEvent::ToolCall {
        tool_call_id: "blocked-terminal".to_string(),
        title: "terminal".to_string(),
        kind: "execute".to_string(),
        status: "in_progress".to_string(),
        content: None,
        raw_input: None,
        raw_output: None,
        locations: None,
        meta: None,
        images: None,
    });
    let state = Arc::new(RwLock::new(initial));
    let (release_tx, release_rx) = tokio::sync::oneshot::channel::<()>();
    let (finished_tx, finished_rx) = tokio::sync::oneshot::channel::<()>();

    let outcome = finish_cancelled_turn_after_cleanup(
        &state,
        &EventEmitter::Noop,
        "cancel-timeout-session",
        AgentType::Grok,
        async move {
            let _ = release_rx.await;
            let _ = finished_tx.send(());
            TerminalCleanupReport::default()
        },
        Duration::from_millis(25),
    )
    .await;

    {
        let settled = state.read().await;
        assert_eq!(outcome, CancelCleanupOutcome::TimedOut);
        assert_eq!(settled.status, ConnectionStatus::Connected);
        assert!(!settled.turn_in_flight, "the next prompt admission gate must reopen");
        assert!(settled.active_tool_calls.is_empty());
        assert!(settled.pending_permission.is_none());
        assert_eq!(
            settled.last_error.as_ref().and_then(|error| error.code.as_deref()),
            Some("terminal_cleanup_incomplete")
        );
    }

    release_tx.send(()).expect("detached cleanup still owns receiver");
    tokio::time::timeout(Duration::from_secs(1), finished_rx)
        .await
        .expect("detached cleanup finishes")
        .expect("cleanup completion signal");
}
```

- [ ] **Step 3: Run the new state test and record the RED compile failure**

Run:

```bash
cargo test --no-default-features acp::connection::tests::terminal_cleanup_timeout_still_completes_cancelled_turn --lib -- --nocapture
```

Expected: compilation FAILS with an unresolved `finish_cancelled_turn_after_cleanup` symbol. This proves the timeout/convergence behavior is specified before its production helper exists.

- [ ] **Step 4: Add the bounded cleanup-and-completion helper**

Place this helper near `run_connection` so both production code and the inline tests can call it:

```rust
async fn finish_cancelled_turn_after_cleanup<F>(
    state: &Arc<RwLock<SessionState>>,
    emitter: &EventEmitter,
    session_id: &str,
    agent_type: AgentType,
    cleanup: F,
    deadline: Duration,
) -> CancelCleanupOutcome
where
    F: Future<Output = TerminalCleanupReport> + Send + 'static,
{
    let started = std::time::Instant::now();
    let cleanup_task = tokio::spawn(cleanup);
    let (outcome, diagnostic) = match tokio::time::timeout(deadline, cleanup_task).await {
        Ok(Ok(report)) if report.is_clean() => (CancelCleanupOutcome::Completed, None),
        Ok(Ok(report)) => {
            let count = report.failure_count();
            (
                CancelCleanupOutcome::Failed(count),
                Some(format!(
                    "{count} terminal cleanup operation(s) failed; cancellation state was recovered"
                )),
            )
        }
        Ok(Err(err)) => (
            CancelCleanupOutcome::TaskFailed,
            Some(format!(
                "terminal cleanup task failed; cancellation state was recovered: {err}"
            )),
        ),
        Err(_) => (
            CancelCleanupOutcome::TimedOut,
            Some(format!(
                "terminal cleanup exceeded {} seconds; cancellation state was recovered and cleanup continues in background",
                deadline.as_secs()
            )),
        ),
    };

    if let Some(message) = diagnostic {
        tracing::warn!(
            session_id,
            agent_type = %agent_type,
            elapsed_ms = started.elapsed().as_millis(),
            ?outcome,
            "[ACP] forcing cancelled turn state convergence after terminal cleanup issue"
        );
        emit_with_state(
            state,
            emitter,
            AcpEvent::Error {
                message,
                agent_type: agent_type.to_string(),
                code: Some("terminal_cleanup_incomplete".to_string()),
                terminal: false,
            },
        )
        .await;
    }

    emit_with_state(
        state,
        emitter,
        AcpEvent::TurnComplete {
            session_id: session_id.to_string(),
            stop_reason: "cancelled".to_string(),
            agent_type: agent_type.to_string(),
        },
    )
    .await;

    outcome
}
```

Dropping the timed-out `JoinHandle` detaches the task in Tokio; the task continues owning all removed `TerminalInstance` values until it finishes.

- [ ] **Step 5: Run the helper test and verify the production branch is still unwired**

Run:

```bash
cargo test --no-default-features acp::connection::tests::terminal_cleanup_timeout_still_completes_cancelled_turn --lib -- --nocapture
```

Expected: PASS for helper semantics. Inspect the active-prompt Cancel branch and confirm it still directly awaits `release_all_for_session` before emitting `TurnComplete`; this is the remaining production wiring gap.

- [ ] **Step 6: Wire active-prompt Cancel through the bounded helper**

In `Some(ConnectionCommand::Cancel)` inside the prompt-response `select!`:

1. keep sending ACP `CancelNotification` first;
2. clear `tracked_terminal_tool_calls` and drain permissions before the bounded wait;
3. clone `terminal_runtime` and session ID into an owned cleanup future;
4. replace the direct cleanup await and direct `TurnComplete` emission with the helper.

Use this exact shape:

```rust
let _ = cx.send_notification_to(Agent, CancelNotification::new(sid.clone()));
tracked_terminal_tool_calls.clear();
let mut locked = perms.lock().await;
for (_, responder) in locked.drain() {
    let _ = responder.respond(RequestPermissionResponse::new(
        RequestPermissionOutcome::Cancelled,
    ));
}
drop(locked);

let cleanup_runtime = Arc::clone(&terminal_runtime);
let cleanup_session_id = sid.0.to_string();
let completion_session_id = cleanup_session_id.clone();
let _cleanup_outcome = finish_cancelled_turn_after_cleanup(
    state,
    emitter,
    &completion_session_id,
    agent_type,
    async move {
        cleanup_runtime
            .release_all_for_session(&cleanup_session_id)
            .await
    },
    CANCEL_TERMINAL_CLEANUP_DEADLINE,
)
.await;
```

Retain delegation cancellation and background prompt-response draining after this helper. Do not emit a second `TurnComplete`.

- [ ] **Step 7: Run connection and session-state cancellation tests**

Run:

```bash
cargo test --no-default-features acp::connection::tests::terminal_cleanup_timeout_still_completes_cancelled_turn --lib -- --nocapture
cargo test --no-default-features acp::session_state::tests::turn_complete_clears_live_and_tool_calls_and_pending_permission --lib
cargo test --no-default-features acp::session_state::tests::turn_complete_clears_pending_user_message --lib
```

Expected: all PASS. The timeout test must complete in substantially less than one second, report `TimedOut`, leave state `Connected`, clear `turn_in_flight` and active tool calls, retain the recoverable error code, and prove the detached cleanup future still finishes after release.

- [ ] **Step 8: Commit the connection-state TDD slice**

```bash
git add src-tauri/src/acp/connection.rs
git commit -m "fix: guarantee ACP cancel state convergence"
```

---

### Task 5: Verify regressions, compatibility, lint, and real Unix process behavior

**Files:**
- Verify only: `src-tauri/src/acp/terminal_runtime.rs`
- Verify only: `src-tauri/src/acp/connection.rs`
- Verify only: `/www/gitroot/codeg` shared checkout and live `codeg-prod` state

**Interfaces:**
- Consumes: the completed implementation and repository commands specified by `AGENTS.md`.
- Produces: command output and process-state evidence for the final report; no source or production mutations.

- [ ] **Step 1: Format only the changed Rust files and inspect the diff**

Run:

```bash
cd /www/gitroot/codeg-worktrees/issue-grok-command-hang/src-tauri
cargo fmt -- src/acp/terminal_runtime.rs src/acp/connection.rs
cd ..
git diff --check
git status --short
git diff --stat HEAD~2..HEAD
git diff HEAD~2..HEAD -- src-tauri/src/acp/terminal_runtime.rs src-tauri/src/acp/connection.rs
```

Expected: `git diff --check` exits 0; only the plan/spec and the two intended Rust files appear across the branch commits. If formatting changes source after the Task 4 commit, stage only those two Rust files and commit `style: format ACP cancellation changes`.

- [ ] **Step 2: Run the targeted regression suite**

Run:

```bash
cd /www/gitroot/codeg-worktrees/issue-grok-command-hang/src-tauri
cargo test --no-default-features acp::terminal_runtime::tests --lib -- --nocapture
cargo test --no-default-features acp::connection::tests::terminal_cleanup_timeout_still_completes_cancelled_turn --lib -- --nocapture
cargo test --no-default-features acp::session_state::tests::turn_complete_clears --lib
```

Expected: all selected tests PASS; no test-owned PID remains.

- [ ] **Step 3: Run the repository-required server-mode Rust tests**

Run:

```bash
cargo test --no-default-features --bin codeg-server --lib
```

If Cargo rejects the simultaneous `--bin` and `--lib` selectors for this package, record that exact output and run the equivalent package library suite:

```bash
cargo test --no-default-features --lib
```

Expected: PASS with zero failed tests.

- [ ] **Step 4: Verify the shared desktop/Tauri build and targeted tests**

Run the default-feature checks required by `AGENTS.md` so the shared runtime change is not validated only through `codeg-server`:

```bash
cargo check
cargo test --features test-utils acp::terminal_runtime::tests --lib
cargo test --features test-utils acp::connection::tests::terminal_cleanup_timeout_still_completes_cancelled_turn --lib
cargo clippy --all-targets --features test-utils -- -D warnings
```

Expected: all commands exit 0. These checks establish that desktop and server modes compile the same changed ACP terminal/cancellation path; the implementation adds no Tauri-only or Axum-only branch.

- [ ] **Step 5: Run server-mode Clippy with warnings denied**

Run:

```bash
cargo clippy --no-default-features --bin codeg-server --lib -- -D warnings
```

If Cargo rejects the combined selectors, record the exact error and run both valid selectors independently:

```bash
cargo clippy --no-default-features --bin codeg-server -- -D warnings
cargo clippy --no-default-features --lib -- -D warnings
```

Expected: all valid Clippy invocations exit 0 with no warnings.

- [ ] **Step 6: Capture read-only production and shared-checkout baselines**

Before the real process test, record:

```bash
git -C /www/gitroot/codeg status --short --branch
git -C /www/gitroot/codeg diff | sha256sum
tmux list-sessions
pgrep -af 'codeg-server|codeg-prod'
curl --fail --silent --show-error --request POST http://127.0.0.1:3080/health
```

For every currently running `codeg-server` PID, record:

```bash
prod_pids=$(pgrep -x codeg-server || true)
for prod_pid in $prod_pids; do
    ps -o pid,ppid,pgid,lstart,state,command -p "$prod_pid"
    readlink "/proc/$prod_pid/exe"
done
```

Do not send any signal and do not restart a tmux session.

- [ ] **Step 7: Run the real stubborn-process regression from the Worktree test binary and sample its process tree**

First build the exact test binary without running it:

```bash
cargo test --no-default-features acp::terminal_runtime::tests::session_cleanup_kills_stubborn_group_without_touching_other_session --lib --no-run
```

Then select the newest emitted Worktree-local test binary, run it with `--exact ... --nocapture`, and sample only the test binary plus its descendants:

```bash
test_bin=$(find target/debug/deps -maxdepth 1 -type f -perm -111 -name 'codeg_lib-*' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)
"$test_bin" --exact acp::terminal_runtime::tests::session_cleanup_kills_stubborn_group_without_touching_other_session --nocapture &
test_runner_pid=$!
for _sample in $(seq 1 35); do
    ps -eo pid,ppid,pgid,state,etime,command --forest | rg "codeg_lib-|trap .*INT TERM|sleep 60" || true
    sleep 0.1
done
wait "$test_runner_pid"
```

Expected evidence:

- the victim shell PID equals its PGID and differs from the test runner PGID;
- its `sleep` child shares the victim PGID;
- the unrelated session has a different PGID;
- logs show `sigint`, `sigterm`, and `sigkill` for the victim only;
- the test passes in under five seconds;
- a post-test `ps`/`pgrep -P` check shows neither victim nor descendants remain;
- the unrelated terminal remained alive until its own cleanup assertion.

- [ ] **Step 8: Confirm no production or shared-main state changed**

Repeat the commands from Step 5. Expected:

- shared checkout branch/status and `git diff | sha256sum` match the baseline;
- production PID, start time, PGID, executable path, and tmux session match the baseline;
- no Worktree test process remains;
- no deployment, restart, API write, or production signal occurred.

- [ ] **Step 9: Review branch scope and commit any final formatting-only delta**

Run:

```bash
cd /www/gitroot/codeg-worktrees/issue-grok-command-hang
git status --short --branch
git log --oneline --decorate --max-count=6
git diff 52b69c84..HEAD --check
git diff 52b69c84..HEAD --name-status
```

Expected changed paths:

- `docs/superpowers/specs/2026-07-18-grok-command-cancellation-design.md`
- `docs/superpowers/plans/2026-07-18-grok-command-cancellation.md`
- `src-tauri/src/acp/terminal_runtime.rs`
- `src-tauri/src/acp/connection.rs`

No push, merge, deployment, or production restart follows this task.

---

### Task 6: Replace the permanent PGID with a bounded process-group lease

**Files:**
- Modify: `src-tauri/src/acp/terminal_runtime.rs:1-710`
- Test: `src-tauri/src/acp/terminal_runtime.rs` inline `#[cfg(all(test, unix))]` module
- Verify unchanged: `src-tauri/src/acp/connection.rs:2203-2285,6070-6130`

**Interfaces:**
- Consumes: the existing `SIGINT_GRACE`, `SIGTERM_GRACE`, `SIGKILL_GRACE`, `CHILD_EXIT_POLL_INTERVAL`, `TerminalInstance::refresh_exit_status`, and five-second connection cleanup deadline.
- Produces: `ProcessGroupKey`, `ProcessGroupPresence`, `ProcessGroupSignalResult`, `UnixProcessGroupBackend`, `LibcProcessGroupBackend`, `UnixProcessGroupLease`, and `UnixProcessGroupState`.
- Invariant: once a lease becomes `Retired`, no method on that terminal may call the backend again.

- [ ] **Step 1: Add the injectable-backend RED tests before production types**

Add an in-memory backend inside the Unix test module. It records keys and
signals, serves scripted probe/signal results, and can switch a numeric PGID to
a simulated later generation without sending a real signal:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
enum BackendCall {
    Probe(ProcessGroupKey),
    Signal(ProcessGroupKey, libc::c_int),
}

#[derive(Default)]
struct MockProcessGroupBackend {
    calls: std::sync::Mutex<Vec<BackendCall>>,
    probes: std::sync::Mutex<VecDeque<ProcessGroupPresence>>,
    signals: std::sync::Mutex<VecDeque<ProcessGroupSignalResult>>,
}

impl MockProcessGroupBackend {
    fn with_probes(
        probes: impl IntoIterator<Item = ProcessGroupPresence>,
    ) -> Self {
        Self {
            probes: std::sync::Mutex::new(probes.into_iter().collect()),
            ..Self::default()
        }
    }

    fn with_signals(
        signals: impl IntoIterator<Item = ProcessGroupSignalResult>,
    ) -> Self {
        Self {
            signals: std::sync::Mutex::new(signals.into_iter().collect()),
            ..Self::default()
        }
    }

    fn calls(&self) -> Vec<BackendCall> {
        self.calls.lock().unwrap().clone()
    }

    fn signals(&self) -> Vec<libc::c_int> {
        self.calls()
            .into_iter()
            .filter_map(|call| match call {
                BackendCall::Signal(_, signal) => Some(signal),
                BackendCall::Probe(_) => None,
            })
            .collect()
    }

    fn clear_calls(&self) {
        self.calls.lock().unwrap().clear();
    }

    fn push_probe(&self, presence: ProcessGroupPresence) {
        self.probes.lock().unwrap().push_back(presence);
    }
}

impl UnixProcessGroupBackend for MockProcessGroupBackend {
    fn probe(
        &self,
        key: ProcessGroupKey,
    ) -> Result<ProcessGroupPresence, TerminalRuntimeError> {
        self.calls.lock().unwrap().push(BackendCall::Probe(key));
        Ok(self
            .probes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(ProcessGroupPresence::Present))
    }

    fn signal(
        &self,
        key: ProcessGroupKey,
        signal: libc::c_int,
    ) -> Result<ProcessGroupSignalResult, TerminalRuntimeError> {
        self.calls
            .lock()
            .unwrap()
            .push(BackendCall::Signal(key, signal));
        Ok(self
            .signals
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(ProcessGroupSignalResult::Delivered))
    }
}
```

Add these helpers and separate tests with exact assertions. `test_lease` builds
the production lease directly because the inline test module can access private
types:

```rust
const TEST_KEY: ProcessGroupKey = ProcessGroupKey {
    pgid: 42_424,
    generation: 7,
};

fn test_lease(
    state: UnixProcessGroupState,
    backend: Arc<MockProcessGroupBackend>,
) -> UnixProcessGroupLease {
    UnixProcessGroupLease {
        backend,
        state: Mutex::new(state),
    }
}

fn zero_grace_stages() -> [(libc::c_int, &'static str, Duration); 3] {
    [
        (libc::SIGINT, "sigint", Duration::ZERO),
        (libc::SIGTERM, "sigterm", Duration::ZERO),
        (libc::SIGKILL, "sigkill", Duration::ZERO),
    ]
}

#[tokio::test]
async fn leader_exit_with_descendants_starts_bounded_lease() {
    let backend = Arc::new(MockProcessGroupBackend::default());
    let lease = test_lease(
        UnixProcessGroupState::OwnedLeaderAlive { key: TEST_KEY },
        backend,
    );
    let observed_at = tokio::time::Instant::now();

    lease.observe_leader_exit(observed_at).await.unwrap();

    assert_eq!(
        *lease.state.lock().await,
        UnixProcessGroupState::OwnedDescendants {
            key: TEST_KEY,
            deadline: observed_at + DESCENDANT_LEASE_DURATION,
        }
    );
}

#[tokio::test]
async fn descendant_lease_release_before_deadline_can_signal_original_group() {
    let backend = Arc::new(MockProcessGroupBackend::with_probes([
        ProcessGroupPresence::Present,
        ProcessGroupPresence::Present,
        ProcessGroupPresence::Missing,
    ]));
    let lease = test_lease(
        UnixProcessGroupState::OwnedDescendants {
            key: TEST_KEY,
            deadline: tokio::time::Instant::now() + DESCENDANT_LEASE_DURATION,
        },
        backend.clone(),
    );

    lease.cleanup_with_stages(&zero_grace_stages()).await.unwrap();

    assert_eq!(
        backend.signals(),
        vec![libc::SIGINT, libc::SIGTERM, libc::SIGKILL]
    );
    assert!(backend.calls().iter().all(|call| match call {
        BackendCall::Probe(key) | BackendCall::Signal(key, _) => *key == TEST_KEY,
    }));
}

#[tokio::test]
async fn expired_descendant_lease_retires_without_backend_call() {
    let backend = Arc::new(MockProcessGroupBackend::default());
    let lease = test_lease(
        UnixProcessGroupState::OwnedDescendants {
            key: TEST_KEY,
            deadline: tokio::time::Instant::now(),
        },
        backend.clone(),
    );

    lease.cleanup_with_stages(&zero_grace_stages()).await.unwrap();

    assert!(backend.calls().is_empty());
    assert_eq!(*lease.state.lock().await, UnixProcessGroupState::Retired);
}

#[tokio::test]
async fn retired_lease_ignores_simulated_pgid_reuse() {
    let backend = Arc::new(MockProcessGroupBackend::with_probes([
        ProcessGroupPresence::Missing,
    ]));
    let lease = test_lease(
        UnixProcessGroupState::OwnedLeaderAlive { key: TEST_KEY },
        backend.clone(),
    );
    lease
        .observe_leader_exit(tokio::time::Instant::now())
        .await
        .unwrap();
    backend.clear_calls();
    backend.push_probe(ProcessGroupPresence::Present);

    lease.cleanup_with_stages(&zero_grace_stages()).await.unwrap();

    assert!(backend.calls().is_empty());
    assert!(backend.signals().is_empty());
}

#[tokio::test]
async fn esrch_retires_permanently_and_repeat_cleanup_is_noop() {
    let backend = Arc::new(MockProcessGroupBackend::with_signals([
        ProcessGroupSignalResult::Missing,
    ]));
    let lease = test_lease(
        UnixProcessGroupState::OwnedLeaderAlive { key: TEST_KEY },
        backend.clone(),
    );
    lease.cleanup_with_stages(&zero_grace_stages()).await.unwrap();
    let calls_after_first = backend.calls();

    lease.cleanup_with_stages(&zero_grace_stages()).await.unwrap();

    assert_eq!(backend.calls(), calls_after_first);
    assert_eq!(*lease.state.lock().await, UnixProcessGroupState::Retired);
}

#[tokio::test]
async fn concurrent_cleanup_runs_one_signal_sequence() {
    let backend = Arc::new(MockProcessGroupBackend::with_probes([
        ProcessGroupPresence::Present,
        ProcessGroupPresence::Present,
        ProcessGroupPresence::Missing,
    ]));
    let lease = Arc::new(test_lease(
        UnixProcessGroupState::OwnedLeaderAlive { key: TEST_KEY },
        backend.clone(),
    ));

    let (left, right) = tokio::join!(
        lease.cleanup_with_stages(&zero_grace_stages()),
        lease.cleanup_with_stages(&zero_grace_stages()),
    );

    left.unwrap();
    right.unwrap();
    assert_eq!(
        backend.signals(),
        vec![libc::SIGINT, libc::SIGTERM, libc::SIGKILL]
    );
}

#[tokio::test]
async fn live_leader_keeps_staged_signal_sequence() {
    let backend = Arc::new(MockProcessGroupBackend::with_probes([
        ProcessGroupPresence::Present,
        ProcessGroupPresence::Present,
        ProcessGroupPresence::Missing,
    ]));
    let lease = test_lease(
        UnixProcessGroupState::OwnedLeaderAlive { key: TEST_KEY },
        backend.clone(),
    );

    lease.cleanup_with_stages(&zero_grace_stages()).await.unwrap();

    assert_eq!(
        backend.signals(),
        vec![libc::SIGINT, libc::SIGTERM, libc::SIGKILL]
    );
}

#[tokio::test]
async fn leader_exit_with_live_descendants_is_not_retired_immediately() {
    let backend = Arc::new(MockProcessGroupBackend::default());
    let lease = test_lease(
        UnixProcessGroupState::OwnedLeaderAlive { key: TEST_KEY },
        backend,
    );

    lease
        .observe_leader_exit(tokio::time::Instant::now())
        .await
        .unwrap();

    assert!(matches!(
        *lease.state.lock().await,
        UnixProcessGroupState::OwnedDescendants { .. }
    ));
}
```

The mock tests must use short zero-duration stage graces supplied to the lease
helper, not the production 500/1500/2000 ms values. Keep the existing real Unix
tests unchanged.

- [ ] **Step 2: Run the new tests and capture RED**

Run:

```bash
cd /www/gitroot/codeg-worktrees/issue-grok-command-hang/src-tauri
cargo test --no-default-features acp::terminal_runtime::tests --lib
```

Expected: compilation fails because the lease/backend interfaces do not yet
exist, or the new assertions fail against the permanent raw-PGID behavior. Do
not write production code until this failure is recorded.

- [ ] **Step 3: Add the minimal lease and production backend**

Add these Unix-only shapes near `TerminalInstance`:

```rust
#[cfg(unix)]
const DESCENDANT_LEASE_DURATION: Duration = Duration::from_secs(5);

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProcessGroupKey {
    pgid: libc::pid_t,
    generation: u64,
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProcessGroupPresence {
    Present,
    Missing,
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProcessGroupSignalResult {
    Delivered,
    Missing,
}

#[cfg(unix)]
trait UnixProcessGroupBackend: Send + Sync {
    fn probe(&self, key: ProcessGroupKey)
        -> Result<ProcessGroupPresence, TerminalRuntimeError>;
    fn signal(
        &self,
        key: ProcessGroupKey,
        signal: libc::c_int,
    ) -> Result<ProcessGroupSignalResult, TerminalRuntimeError>;
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UnixProcessGroupState {
    OwnedLeaderAlive { key: ProcessGroupKey },
    OwnedDescendants {
        key: ProcessGroupKey,
        deadline: tokio::time::Instant,
    },
    Retired,
}

#[cfg(unix)]
struct UnixProcessGroupLease {
    backend: Arc<dyn UnixProcessGroupBackend>,
    state: Mutex<UnixProcessGroupState>,
}
```

`LibcProcessGroupBackend::probe` maps `kill(-pgid, 0)` success/`EPERM` to
`Present` and `ESRCH` to `Missing`. `signal` maps success to `Delivered` and
`ESRCH` to `Missing`; other errors remain `TerminalRuntimeError::Internal`.
The production backend ignores the internal generation when calling libc but
includes it in errors and logs.

- [ ] **Step 4: Allocate a generation and wire leader-exit retirement**

Add a Unix-only `AtomicU64` generation counter to `TerminalRuntime`, initialized
to one. Every successful spawn obtains one generation and constructs an
`OwnedLeaderAlive` lease for `pgid == pid`.

In `refresh_exit_status`, after `try_wait` reports the direct child exit and
before publishing the cached exit status, call:

```rust
self.process_group
    .observe_leader_exit(tokio::time::Instant::now())
    .await?;
```

`observe_leader_exit` performs its probe while holding the lease state lock:

```rust
match backend.probe(key)? {
    ProcessGroupPresence::Missing => *state = UnixProcessGroupState::Retired,
    ProcessGroupPresence::Present => {
        *state = UnixProcessGroupState::OwnedDescendants {
            key,
            deadline: observed_at + DESCENDANT_LEASE_DURATION,
        };
    }
}
```

If state is already `Retired`, perform no backend call. Never renew an existing
`OwnedDescendants` deadline.

- [ ] **Step 5: Move escalation behind the bounded lease lock**

Replace direct `process_group_exists` and `signal_process_group` calls with one
`UnixProcessGroupLease::cleanup` method. It acquires the lease state lock once
for the bounded sequence, checks descendant expiry before every backend call
and after each sleep, and uses the remaining lease time as an upper bound on
the stage sleep.

Rules inside `cleanup`:

```rust
// Retired: return immediately without backend use.
// OwnedDescendants at/after deadline: set Retired and return immediately.
// probe/signal Missing: set Retired and return immediately.
// Delivered: wait only min(stage_grace, descendant_deadline - now).
// Deadline reached while waiting: set Retired; do not perform a final probe.
// Never replace an existing descendant deadline with now + 5 seconds.
```

Keep `TerminalInstance::kill_command` responsible for child refresh/reaping and
sanitized logging, but make all Unix group ownership decisions and syscalls go
through `UnixProcessGroupLease`. Because cleanup holds the state lock for the
entire bounded sequence, two concurrent release calls cannot signal twice.

- [ ] **Step 6: Run lease and real Unix terminal tests GREEN**

Run:

```bash
cargo test --no-default-features acp::terminal_runtime::tests --lib -- --nocapture
```

Expected: every mock lease test and all existing real Unix process tests pass;
the stubborn group still logs SIGINT, SIGTERM, SIGKILL and the unrelated
session stays alive until its own cleanup.

- [ ] **Step 7: Verify Cancel state convergence and full Server regression**

Run serially:

```bash
cargo test --no-default-features acp::connection::tests::terminal_cleanup_timeout_still_completes_cancelled_turn --lib
cargo test --no-default-features --bin codeg-server --lib
cargo clippy --no-default-features --bin codeg-server --lib -- -D warnings
```

Expected: Cancel timeout test passes, full Server suite has zero failures, and
Clippy exits zero with warnings denied.

- [ ] **Step 8: Confirm Windows source path and branch scope**

Inspect the diff and confirm `#[cfg(not(unix))] TerminalInstance::kill_command`
still calls the existing `kill_tree` behavior. Then run:

```bash
git diff --check
git status --short --branch
git diff 0b935050..HEAD --name-status
```

Expected: implementation changes are limited to the tracked design/plan and
`src-tauri/src/acp/terminal_runtime.rs`; `connection.rs` only changes if its
existing Cancel test requires a test-only adjustment.

- [ ] **Step 9: Commit the security fix without push or merge**

```bash
git add src-tauri/src/acp/terminal_runtime.rs
git commit -m "fix: retire stale Unix process-group leases"
```

Do not push, merge, deploy, restart `codeg-prod`, or modify `/www/gitroot/codeg`.

---

## Final report checklist

- State the independent Worktree path and branch.
- List exact changed files and commits.
- Report the initial RED failures and the final PASS commands with counts/durations.
- Report real victim PID/PGID/descendant evidence, signal stages, elapsed cancellation time, and unaffected-session evidence.
- State that `TurnComplete` convergence was tested under an artificial cleanup timeout and that `turn_in_flight` reopened.
- State the read-only production/shared-main before-and-after comparison.
- Call out remaining Windows, ACP agent-supervisor, FIFO Cancel queue, and theoretical PGID-reuse risks.
- Do not claim deployment or production validation; explicitly state that neither occurred.
