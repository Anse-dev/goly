# Changelog

All notable changes will be documented in this file.

## [1.0.0] - 2026-07-06

### Added
- Initial release
- Cockpit sidebar with worktree listing
- Branch, ahead/behind, modified files display
- Port awareness and conflict detection
- Process monitoring per worktree
- Agent detection (Claude Code, Codex, Cursor, Windsurf, Copilot)
- Review Mode (PR/branch → worktree → new window)
- Context snapshots (files, layout, breakpoints)
- QuickPick-based worktree creation wizard
- Configurable base directory for worktrees
- Auto-refresh with debouncing
- Status bar with worktree count
- Cross-platform support (macOS, Linux, Windows)
- GitHub Actions CI/CD

### Features
- 🎛️ Visual cockpit sidebar
- 🔌 Port tracking and conflict badges
- 🤖 AI agent detection
- 🔍 Review Mode
- 💾 Context Snapshots
- ⚡ Fast activation (<300ms)

---

## Roadmap

### v1.1
- [ ] Dashboard webview with detailed analytics
- [ ] Compare Mode (visual diff between worktrees)
- [ ] Workspace Groups

### v1.2
- [ ] Conflict prediction (detect merge conflicts before they happen)
- [ ] Team features (shared snapshots)

### v2.0
- [ ] Cloud sync for snapshots
- [ ] Multi-repo support
- [ ] Collaboration features
