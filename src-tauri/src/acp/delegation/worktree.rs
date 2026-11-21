//! keh4l build: `isolation: "worktree"` for `delegate_to_agent` — the child
//! works in a git worktree of its own, on a new branch made from the commit the
//! parent's checkout is on, so parallel children (and the parent) never edit
//! the same files.
//!
//! As in T3 Code: the base is the parent checkout's `HEAD` commit, so the
//! parent's uncommitted changes are not there (the ack says how many there
//! are); nothing here merges or deletes — the parent agent or the user does
//! that with git, or removes the worktree from the delegation card. The
//! worktree goes where Codeg's other worktrees of that folder go (the work-task
//! "worktree location" setting), else beside the repository.

use std::path::{Path, PathBuf};

/// A worktree made for one delegated task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DelegationWorktree {
    /// The top of the checkout the parent works in (its own worktree when it
    /// is in one) — what `git worktree remove` is run from.
    pub repository: PathBuf,
    /// The new worktree's top.
    pub root: PathBuf,
    /// Where the child starts: the same subdirectory of `root` the parent's
    /// directory is of `repository`.
    pub working_dir: PathBuf,
    pub branch: String,
    pub base_sha: String,
    /// Uncommitted entries in the parent's checkout, which the child does not
    /// see.
    pub parent_uncommitted: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorktreeError {
    /// The parent does not work in a git repository (or one with no commit).
    Unavailable(String),
    /// git refused.
    Failed(String),
}

impl WorktreeError {
    pub fn code(&self) -> &'static str {
        match self {
            WorktreeError::Unavailable(_) => "isolation_unavailable",
            WorktreeError::Failed(_) => "worktree_failed",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            WorktreeError::Unavailable(m) | WorktreeError::Failed(m) => m,
        }
    }
}

async fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = crate::process::tokio_command("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            err
        })
    }
}

/// Where a worktree named `name` of the repository at `repository` goes:
/// under the configured location (`~` expanded; relative to the repository),
/// else beside the repository.
pub fn location(repository: &Path, configured: Option<&str>, name: &str) -> PathBuf {
    if let Some(base) = configured.map(str::trim).filter(|b| !b.is_empty()) {
        let expanded = match base.strip_prefix("~") {
            Some(rest) if rest.is_empty() || rest.starts_with(['/', '\\']) => {
                match dirs::home_dir() {
                    Some(home) => home.join(rest.trim_start_matches(['/', '\\'])),
                    None => PathBuf::from(base),
                }
            }
            _ => PathBuf::from(base),
        };
        let base = if expanded.is_absolute() {
            expanded
        } else {
            repository.join(expanded)
        };
        return base.join(name);
    }
    match repository.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.join(name),
        _ => PathBuf::from(name),
    }
}

/// Make the worktree for a task whose parent works in `parent_dir`. `label`
/// names it (`delegate/<label>`, `<repo>-delegate-<label>`); `fallback` is
/// tried when that name is taken.
pub async fn create(
    parent_dir: &Path,
    label: &str,
    fallback: &str,
    configured_location: Option<&str>,
) -> Result<DelegationWorktree, WorktreeError> {
    let top = git(parent_dir, &["rev-parse", "--show-toplevel"])
        .await
        .map_err(|_| {
            WorktreeError::Unavailable(format!(
                "{} is not in a git repository, so there is nothing to make a worktree of; \
                 delegate with isolation \"shared\" instead",
                parent_dir.display()
            ))
        })?;
    let repository = PathBuf::from(top);
    let prefix = git(parent_dir, &["rev-parse", "--show-prefix"])
        .await
        .unwrap_or_default();
    let base_sha = git(&repository, &["rev-parse", "--verify", "HEAD^{commit}"])
        .await
        .map_err(|_| {
            WorktreeError::Unavailable(format!(
                "{} has no commit yet to start a worktree from; commit first, or delegate with \
                 isolation \"shared\"",
                repository.display()
            ))
        })?;
    let parent_uncommitted = git(&repository, &["status", "--porcelain"])
        .await
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);
    let repo_name = repository
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "workspace".into());
    let mut first_error: Option<String> = None;
    for label in [label, fallback] {
        let branch = format!("delegate/{label}");
        let root = location(
            &repository,
            configured_location,
            &format!("{repo_name}-delegate-{label}"),
        );
        match attempt(&repository, &root, &branch, &base_sha).await {
            Ok(()) => {
                let working_dir = if prefix.is_empty() {
                    root.clone()
                } else {
                    root.join(&prefix)
                };
                let made = DelegationWorktree {
                    repository: repository.clone(),
                    root,
                    working_dir,
                    branch,
                    base_sha: base_sha.clone(),
                    parent_uncommitted,
                };
                if !made.working_dir.is_dir() {
                    remove(&made, true).await;
                    return Err(WorktreeError::Failed(format!(
                        "{prefix} is not in commit {}, so the new worktree has no such \
                         directory; commit it, or delegate with isolation \"shared\"",
                        short_sha(&base_sha)
                    )));
                }
                return Ok(made);
            }
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    Err(WorktreeError::Failed(format!(
        "could not add a worktree to {}: {}",
        repository.display(),
        first_error.unwrap_or_default()
    )))
}

/// One try: claim the directory (creating it fails if anything is there),
/// then the branch (creating a ref that exists fails), then check it out.
/// Whatever this try claimed is given back on failure.
async fn attempt(repository: &Path, root: &Path, branch: &str, base: &str) -> Result<(), String> {
    if let Some(parent) = root.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::create_dir(root).map_err(|e| format!("{}: {e}", root.display()))?;
    if let Err(e) = git(repository, &["branch", "--no-track", branch, base]).await {
        let _ = std::fs::remove_dir(root);
        return Err(e);
    }
    let root_arg = root.to_string_lossy().into_owned();
    if let Err(e) = git(repository, &["worktree", "add", &root_arg, branch]).await {
        let _ = git(repository, &["worktree", "prune"]).await;
        let _ = std::fs::remove_dir_all(root);
        let _ = git(repository, &["branch", "-D", branch]).await;
        return Err(e);
    }
    Ok(())
}

/// Take a worktree this module made away again (a launch that failed after
/// it was made), with its branch when `with_branch`.
pub async fn remove(worktree: &DelegationWorktree, with_branch: bool) {
    let root = worktree.root.to_string_lossy().into_owned();
    if git(
        &worktree.repository,
        &["worktree", "remove", "--force", &root],
    )
    .await
    .is_err()
    {
        let _ = std::fs::remove_dir_all(&worktree.root);
        let _ = git(&worktree.repository, &["worktree", "prune"]).await;
    }
    if with_branch {
        let _ = git(&worktree.repository, &["branch", "-D", &worktree.branch]).await;
    }
}

pub fn short_sha(sha: &str) -> &str {
    &sha[..sha.len().min(8)]
}

/// One line on what the task changed in its worktree: commits on the branch,
/// files differing from the base, and how many of those are not committed.
/// `None` when the worktree is gone or git cannot tell.
pub async fn changes(root: &Path, base_sha: &str) -> Option<String> {
    if !root.is_dir() {
        return None;
    }
    let commits: usize = git(root, &["rev-list", "--count", &format!("{base_sha}..HEAD")])
        .await
        .ok()?
        .trim()
        .parse()
        .ok()?;
    let stat = git(root, &["diff", "--shortstat", base_sha]).await.ok()?;
    let uncommitted = git(root, &["status", "--porcelain"])
        .await
        .ok()?
        .lines()
        .filter(|l| !l.trim().is_empty())
        .count();
    let files = stat
        .split(',')
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("no changes")
        .to_string();
    let mut parts = vec![files];
    if commits > 0 {
        parts.push(format!(
            "{commits} commit{}",
            if commits == 1 { "" } else { "s" }
        ));
    }
    if uncommitted > 0 {
        parts.push(format!("{uncommitted} uncommitted"));
    }
    Some(parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .expect("git runs");
        assert!(status.success(), "git {args:?}");
    }

    fn repo() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("proj");
        std::fs::create_dir_all(repo.join("app/src")).unwrap();
        run(&repo, &["init", "-q", "-b", "main"]);
        std::fs::write(repo.join("app/src/lib.rs"), "fn a() {}\n").unwrap();
        run(&repo, &["add", "."]);
        run(&repo, &["commit", "-q", "-m", "init"]);
        (tmp, repo)
    }

    #[tokio::test]
    async fn a_worktree_starts_from_the_parent_head_in_the_same_subdirectory() {
        let (_tmp, repo) = repo();
        // Uncommitted in the parent: not carried over, but counted.
        std::fs::write(repo.join("app/src/lib.rs"), "fn b() {}\n").unwrap();
        let wt = create(&repo.join("app"), "9f3a1c22", "9f3a1c22-x", None)
            .await
            .expect("made");
        assert_eq!(wt.branch, "delegate/9f3a1c22");
        assert_eq!(
            wt.root,
            repo.parent().unwrap().join("proj-delegate-9f3a1c22")
        );
        assert_eq!(wt.working_dir, wt.root.join("app/"));
        assert_eq!(wt.parent_uncommitted, 1);
        assert_eq!(
            std::fs::read_to_string(wt.working_dir.join("src/lib.rs")).unwrap(),
            "fn a() {}\n"
        );
        assert_eq!(
            changes(&wt.root, &wt.base_sha).await.as_deref(),
            Some("no changes")
        );

        std::fs::write(wt.root.join("app/src/new.rs"), "x").unwrap();
        std::fs::write(wt.root.join("app/src/lib.rs"), "fn c() {}\n").unwrap();
        run(&wt.root, &["add", "app/src/lib.rs"]);
        run(&wt.root, &["commit", "-q", "-m", "c"]);
        assert_eq!(
            changes(&wt.root, &wt.base_sha).await.as_deref(),
            Some("1 file changed, 1 commit, 1 uncommitted")
        );

        // The name is taken: the fallback is used.
        let second = create(&repo, "9f3a1c22", "9f3a1c22-x", None)
            .await
            .expect("made");
        assert_eq!(second.branch, "delegate/9f3a1c22-x");

        remove(&wt, true).await;
        assert!(!wt.root.exists());
        remove(&second, true).await;
    }

    #[tokio::test]
    async fn outside_a_repository_there_is_no_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let err = create(tmp.path(), "a", "b", None).await.unwrap_err();
        assert_eq!(err.code(), "isolation_unavailable");
    }

    #[test]
    fn the_configured_location_wins() {
        let repo = Path::new("/work/proj");
        assert_eq!(location(repo, None, "x"), PathBuf::from("/work/x"));
        assert_eq!(location(repo, Some("  "), "x"), PathBuf::from("/work/x"));
        assert_eq!(location(repo, Some("/wt"), "x"), PathBuf::from("/wt/x"));
        assert_eq!(
            location(repo, Some(".wt"), "x"),
            PathBuf::from("/work/proj/.wt/x")
        );
    }
}
