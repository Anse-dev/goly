# Contributing to Goly

Thank you for your interest in contributing!

## Development Setup

1. Clone the repository
2. Install Node.js 20 and dependencies: `npm ci`
3. Build: `npm run build`
4. Open in VS Code: `code .`
5. Press F5 to run Extension Development Host

## Scripts

```bash
npm run build          # Build extension
npm run watch         # Watch mode
npm run test           # Run unit tests
npm run test:watch     # Watch tests
npm run test:integration # Run in a VS Code test host
npm run lint           # Lint code
npm run format         # Format code
npm run typecheck      # Type check
npm run check          # Run all local quality gates
npm run package        # Build a minimal VSIX
```

## Project Structure

```
src/
├── core/           # Utilities (types, logger, config)
├── git/            # Git CLI client
├── worktrees/      # Worktree domain
├── ports/          # Port/process inspection
├── review/         # Review mode
├── snapshots/      # Context snapshots
└── ui/
    └── sidebar/   # TreeView provider
```

## Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## Issues

Found a bug? Open an issue with:
- VS Code version
- Extension version
- Steps to reproduce
- Expected vs actual behavior

## Questions?

Open a discussion or reach out!

---

Made with ❤️ by the Goly Team
