# Goly — Parallel Workspaces & Worktree Cockpit

<div align="center">

![Goly](media/icon.png)

**The cockpit for parallel development sessions. Monitor worktrees, ports, processes, and agents in real-time. Native in VS Code.**

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/goly-dev.goly)](https://marketplace.visualstudio.com/items?itemName=goly-dev.goly)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/goly-dev.goly)](https://marketplace.visualstudio.com/items?itemName=goly-dev.goly)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ✨ Features

### 🎛️ Cockpit Sidebar
All your worktrees at a glance with **live status**:

```
● main        ↑2 ↓1  ~12  :3000
● feature/auth    ~8  :3001  🤖 Claude Code
● review/pr-42        :3002
```

- Branch + ahead/behind
- Modified files count
- Open ports
- Agent detection (🤖)
- Last activity

### 🔌 Port Awareness
Never clash on ports again. Goly shows:
- Which worktree uses which port
- Conflict badges
- Automatic port suggestions

### 🤖 Agent Detection
Detects when you're running AI coding agents:
- Claude Code
- Codex
- Cursor
- Windsurf
- GitHub Copilot

### 🔍 Review Mode
Review PRs in one click:
```
Goly: Review Branch/PR → fetch → worktree → new window → review → cleanup
```

### 💾 Context Snapshots
Save and restore your workspace context:
- Open files
- Editor layout
- Breakpoints
- Terminal sessions (cwd + restart command)

---

## 🚀 Quick Start

### Installation

1. Open VS Code
2. Press `Cmd/Ctrl + P`
3. Type: `ext install goly-dev.goly`
4. Press Enter

Or search for **"Goly"** in the VS Code Extensions Marketplace.

### Usage

1. Open a Git repository in VS Code
2. See your worktrees in the **Goly** sidebar
3. Right-click to:
   - Open in New Window
   - Open Terminal
   - Save Snapshot
   - Compare with Main
   - Remove

### Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Goly: Refresh` | `Cmd+Shift+G R` | Refresh worktree list |
| `Goly: Create Worktree` | `Cmd+Shift+G N` | Create new worktree |
| `Goly: Review Branch/PR` | — | Start review session |
| `Goly: Save Snapshot` | — | Save workspace context |
| `Goly: Restore Snapshot` | — | Restore saved context |

---

## 🎯 Use Cases

### Multi-Branch Development
Work on multiple features simultaneously without switching branches:
```
main → feature/payment → feature/auth → hotfix/security
```

### Code Review
Review PRs without cluttering your main workspace:
```
review/pr-152 → review/pr-153 → review/pr-154
```

### AI Agent Orchestration
Track multiple AI agents working in parallel:
```
Claude Code in feature/backend
Cursor in feature/frontend
```

---

## ⚙️ Configuration

```json
{
  "goly.baseDirectory": "~/workspaces",
  "goly.autoRefresh": true,
  "goly.refreshInterval": 5000,
  "goly.autoOpenInNewWindow": true,
  "goly.confirmBeforeDelete": true,
  "goly.portRangeStart": 3000,
  "goly.envFilePatterns": [".env.local", ".env.*.local"],
  "goly.postCreateCommands": ["npm install"]
}
```

---

## 🆚 Comparison

| Feature | GitLens | Native | **Goly** |
|---------|---------|--------|----------|
| Worktree CRUD | ✅ | ✅ | ✅ |
| Visual Cockpit | ❌ | ❌ | ✅ |
| Port Tracking | ❌ | ❌ | ✅ |
| Agent Detection | ❌ | ❌ | ✅ |
| Review Mode | ❌ | ❌ | ✅ |
| Snapshots | ❌ | ❌ | ✅ |
| Open Source | ❌ | ✅ | ✅ |
| Free | ❌ | ✅ | ✅ |

---

## 📦 Tech Stack

- **TypeScript** with strict mode
- **VS Code Extension API** (native TreeView)
- **Git CLI** (porcelain output parsing)
- **esbuild** for fast bundling
- **vitest** for testing

---

## 🤝 Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.

---

## 📄 License

MIT © Goly Team

---

<div align="center">

**Made with ❤️ for developers who work in parallel**

</div>
