# Goly

**Parallel Workspaces & Worktree Cockpit**

The cockpit for parallel development sessions. Monitor worktrees, ports, processes, and AI agents in real-time. Native in VS Code.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/goly-dev.goly)](https://marketplace.visualstudio.com/items?itemName=goly-dev.goly)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/goly-dev.goly)](https://marketplace.visualstudio.com/items?itemName=goly-dev.goly)
[![Stars](https://img.shields.io/github/stars/goly-dev/goly)](https://github.com/goly-dev/goly)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[Install](https://marketplace.visualstudio.com/items?itemName=goly-dev.goly) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)**

---

## Why Goly?

Work on multiple branches simultaneously without losing context.

### See everything at a glance

```
main          ↑2  ~12  :3000
feature/payment  ~8  :3001  🤖 Claude Code
review/pr-152      :3002  (idle 2h ago)
```

- Branch + ahead/behind status
- Modified files count
- Open ports
- AI agent detection
- Last activity

### Never clash on ports again

Goly shows which worktree uses which port and warns you about conflicts.

### Track AI agents

Detects Claude Code, Codex, Cursor, Windsurf, Copilot running in your worktrees.

### Review PRs in one click

Fetch → worktree → new window → review → cleanup

### Restore context instantly

Save snapshots of open files, breakpoints, and terminal state.

---

## Install

1. Open VS Code
2. Press Cmd/Ctrl + P
3. Type: `ext install goly-dev.goly`
4. Press Enter

---

## Quick Start

1. Open a Git repository in VS Code
2. Find the **Goly** sidebar (layers icon) in the Activity Bar
3. Right-click any worktree to:
   - Open in New Window
   - Open Terminal Here
   - Save Snapshot
   - Compare with Main
   - Remove

### Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Goly: Refresh | Cmd+Shift+G R | Refresh worktree list |
| Goly: Create Worktree | Cmd+Shift+G N | Create new worktree |
| Goly: Review Branch/PR | - | Start review workflow |
| Goly: Save Snapshot | - | Save current context |
| Goly: Restore Snapshot | - | Restore saved context |

---

## Configuration

```json
{
  "goly.baseDirectory": "~/workspaces",
  "goly.autoRefresh": true,
  "goly.refreshInterval": 5000,
  "goly.autoOpenInNewWindow": true,
  "goly.confirmBeforeDelete": true,
  "goly.portRangeStart": 3000,
  "goly.envFilePatterns": [".env.local"],
  "goly.postCreateCommands": ["npm install"]
}
```

---

## Comparison

| Feature | GitLens Pro | Native | Goly |
|---------|-------------|--------|------|
| Worktree CRUD | yes | yes | yes |
| Visual Cockpit | no | no | **yes** |
| Port Tracking | no | no | **yes** |
| Agent Detection | no | no | **yes** |
| Review Mode | no | no | **yes** |
| Snapshots | no | no | **yes** |
| Free | no | yes | **yes** |

---

## Use Cases

### Multi-Branch Development

Work on features in parallel without branch switching.

### Code Review

Review multiple PRs simultaneously without leaving your main workspace.

### AI Agent Orchestration

Track multiple AI coding assistants working in different branches.

---

## Tech Stack

- TypeScript with strict mode
- VS Code Extension API (native TreeView)
- Git CLI (porcelain output parsing)
- esbuild for fast bundling
- vitest for testing
- GitHub Actions for CI/CD

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/goly-dev/goly.git
cd goly
npm install
npm run build
# F5 to debug
```

---

## License

MIT - see [LICENSE](LICENSE)
