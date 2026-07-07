# Goly Release Notes

## 1.1.0 — Parallel branches, under control

Goly 1.1 introduces a dedicated Git worktree cockpit for VS Code. It is built for developers who keep features, fixes, reviews, and coding agents moving at the same time.

### Run branches side by side

- Create worktrees from new or existing branches
- Open every worktree in its own VS Code window
- Copy local environment files automatically
- Run configurable setup commands after creation
- Remove worktrees and branches with explicit safety checks

### See what is happening

- Live ahead/behind branch status
- Staged, modified, and untracked file counts
- Listening ports and cross-worktree conflict warnings
- Process visibility scoped to each worktree
- Detection for Claude Code, Codex, Cursor, Windsurf, and Copilot

### Review without disturbing your workspace

- Fetch branches and pull-request refs into isolated review worktrees
- Compare a worktree against the main branch
- End a review session and clean up its temporary branch

### Leave and return without losing context

- Save named workspace snapshots
- Restore open files and editor columns
- Recreate terminal locations
- Restore only the breakpoints belonging to that worktree

### Local-first by design

- No account, cloud sync, or telemetry
- Shell-safe Git and process execution
- Workspace Trust protection for configured commands
- Cross-platform support for macOS, Linux, and Windows

### Built with release confidence

- Strict TypeScript and lint gates
- Unit tests against real temporary Git repositories
- VS Code Extension Host integration testing
- Lean Marketplace package with no production dependencies
- Zero known npm vulnerabilities at release

---

## 1.0.0 — Initial release

- First public version of the Goly worktree experiment
