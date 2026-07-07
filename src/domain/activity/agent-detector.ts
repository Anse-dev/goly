import type { ProcessInfo } from '../../ports/inspector.js';

const AGENT_PATTERNS: ReadonlyArray<{ name: string; patterns: RegExp[] }> = [
  { name: 'Claude Code', patterns: [/\bclaude\b/i] },
  { name: 'Codex', patterns: [/\bcodex\b/i] },
  { name: 'Cursor', patterns: [/\bcursor\b/i] },
  { name: 'Windsurf', patterns: [/\bwindsurf\b/i, /\bcodeium\b/i] },
  { name: 'Copilot', patterns: [/\bcopilot\b/i] },
];

export function identifyAgent(
  processes: readonly ProcessInfo[],
): string | undefined {
  for (const process of processes) {
    const searchable = `${process.name} ${process.command}`;
    for (const agent of AGENT_PATTERNS) {
      if (agent.patterns.some((pattern) => pattern.test(searchable))) {
        return agent.name;
      }
    }
  }
  return undefined;
}
