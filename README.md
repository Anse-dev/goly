# Goly — Parallel Workspaces & Worktree Cockpit

<div align="center">

![Banner](media/banner.png)

**The cockpit for parallel development sessions.**

Monitor worktrees, ports, processes, and AI agents in real-time. Native in VS Code.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/goly-dev.goly?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=goly-dev.goly)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/goly-dev.goly?style=for-the-badge&logo=臣)](https://marketplace.visualstudio.com/items?itemName=goly-dev.goly)
[![Stars](https://img.shields.io/github/stars/goly-dev/goly?style=for-the-badge&logo=github)](https://github.com/goly-dev/goly)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Twitter](https://img.shields.io/badge/Twitter-@golydev-1DA1F2?style=for-the-badge&logo=twitter)](https://twitter.com/golydev)

**[Install](https://marketplace.visualstudio.com/items?itemName=goly-dev.goly) · [Documentation](docs/) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)**

</div>

---

## ✨ Why Goly?

In 2026, developers work differently:

```
┌─────────────────────────────────────────────────────────────┐
│  main (production)     │  feature/payment  │  review/pr-42 │
│  npm run dev:3000      │  Claude Code      │  Windsurf      │
│  ...                   │  :3001            │  :3002         │
└─────────────────────────────────────────────────────────────┘
```

**Multiple branches. Multiple agents. Multiple ports.** But no visibility.

**Goly gives you the cockpit view** — see everything at a glance, spot conflicts before they happen, and never lose context again.

---

## 🎯 The Problem

| ❌ Without Goly | ✅ With Goly |
|----------------|--------------|
| "Which port is feature using again?" | Ports shown per worktree |
| "Is Claude Code still running in that branch?" | 🤖 Agent badge |
| "Did I forget to commit something?" | Live status with modified files |
| "Let me checkout to review this PR..." | One-click review mode |
| "Where was I on that branch?" | Snapshots restore context |

---

## 🚀 Features

### 🎛️ Live Cockpit Sidebar

```
● main          ↑2 ↓0  ~12  :3000
● feature/payment   ~8  :3001  🤖 Claude Code
● review/pr-152     :3002  (idle 2h ago)
```

All your worktrees with:
- Branch name + ahead/behind
- Modified/staged/untracked counts
- Open ports
- 🤖 AI agent detection
- Last activity timestamp

### 🔌 Port Awareness

Never clash on ports again:

- **Visual port mapping** — see which worktree uses which port
- **Conflict badges** — instant warning when ports overlap
- **Auto-suggestion** — "Port 3000 is taken by `main`. Launch on 3001?"

### 🤖 Agent Detection

Heuristic detection of AI coding agents:

- Claude Code
- Codex / OpenAI
- Cursor
- Windsurf
- GitHub Copilot

See at a glance which agent is working where.

### 🔍 Review Mode

```
Goly: Review Branch/PR
        ↓
   Fetch ref
        ↓
   Create worktree (review/<ref>)
        ↓
   Open in new window
        ↓
   Review code
        ↓
   Cleanup with one click
```

### 💾 Context Snapshots

Save your complete workspace context:

- Open files & editor layout
- Breakpoints
- Terminal sessions (cwd + restart command)
- Restore in one click

### ⚡ Built for Speed

| Action | Time |
|--------|------|
| Extension activation | < 300ms |
| Sidebar refresh (10 worktrees) | < 500ms |
| Worktree creation | < 3s |

---

## 📦 Installation

### VS Code Marketplace (Recommended)

1. Open VS Code
2. Press `Cmd/Ctrl + P`
3. Type: `ext install goly-dev.goly`
4. Press Enter

### Open VSX (For Cursor/Windsurf Users)

Install from [open-vsx.org](https://open-vsx.org/extension/goly-dev/goly)

---

## 🎮 Quick Start

1. **Open a Git repository** in VS Code
2. **Look for the Goly sidebar** (layers icon) in the Activity Bar
3. **Right-click** any worktree to:
   - Open in New Window
   - Open Terminal Here
   - Save Snapshot
   - Compare with Main
   - Remove

### Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Goly: Refresh` | `Cmd+Shift+G R` | Refresh worktree list |
| `Goly: Create Worktree` | `Cmd+Shift+G N` | Create new worktree |
| `Goly: Review Branch/PR` | — | Start review workflow |
| `Goly: Save Snapshot` | — | Save current context |
| `Goly: Restore Snapshot` | — | Restore saved context |

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

| Feature | GitLens Pro | Native | **Goly** |
|---------|-------------|--------|----------|
| Worktree CRUD | ✅ | ✅ | ✅ |
| Visual Cockpit | ❌ | ❌ | ✅ |
| Port Tracking | ❌ | ❌ | ✅ |
| Agent Detection | ❌ | ❌ | ✅ |
| Review Mode | ❌ | ❌ | ✅ |
| Snapshots | ❌ | ❌ | ✅ |
| Open Source | ❌ | ✅ | ✅ |
| **Free** | ❌ | ✅ | ✅ |

> GitLens charges for worktree features. Goly is **100% free and open source**.

---

## 🌟 Use Cases

### Multi-Branch Development

Work on features in parallel without branch switching:

```
main ──── feature/backend ──── feature/frontend ──── hotfix/security
 :3000      :3001              :3002                :3003
```

### Code Review Workflow

Review multiple PRs simultaneously:

```
review/pr-152 ── review/pr-153 ── review/pr-154
```

### AI Agent Orchestration

Track multiple AI coding assistants:

```
Claude Code in feature/payment  (active)
Cursor in feature/auth         (idle 30m ago)
Windsurf in refactor/cleanup  (active)
```

---

## 🛠️ Tech Stack

- **TypeScript** with strict mode
- **VS Code Extension API** (native TreeView)
- **Git CLI** (porcelain output parsing)
- **esbuild** for fast bundling
- **vitest** for testing
- **GitHub Actions** for CI/CD

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
# Development setup
git clone https://github.com/goly-dev/goly.git
cd goly
npm install
npm run build
# F5 to debug
```

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

## 🙏 Acknowledgments

- [Git Worktree Manager](https://marketplace.visualstudio.com/items?itemName=jackiotyu.git-worktree-manager) — inspiration
- [VS Code](https://code.visualstudio.com/) — the best code editor
- All [contributors](https://github.com/goly-dev/goly/graphs/contributors)

---

<div align="center">

**Made with ❤️ for developers who refuse to switch branches**

[Install](https://marketplace.visualstudio.com/items?itemName=goly-dev.goly) · [Star on GitHub](https://github.com/goly-dev/goly) · [Follow on Twitter](https://twitter.com/golydev)

</div>
