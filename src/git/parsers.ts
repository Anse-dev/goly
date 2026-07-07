import * as path from 'path';
import type { BranchInfo, StatusInfo, Worktree } from './client.js';

export function parseWorktreeList(output: string): Worktree[] {
  const normalized = output.includes('\0')
    ? output.replace(/\0/g, '\n')
    : output.replace(/\r\n/g, '\n');
  const entries = normalized.split(/\n\n+/).filter((entry) => entry.trim());
  const worktrees: Worktree[] = [];

  for (const entry of entries) {
    let worktreePath = '';
    let branch = '';
    let head = '';
    let isBare = false;
    let isPrunable = false;

    for (const line of entry.split('\n')) {
      if (line.startsWith('worktree ')) {
        worktreePath = path.normalize(line.slice('worktree '.length));
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      } else if (line === 'bare') {
        isBare = true;
      } else if (line === 'detached') {
        branch = 'detached';
      } else if (line.startsWith('prunable')) {
        isPrunable = true;
      }
    }

    if (worktreePath && !isPrunable) {
      worktrees.push({
        path: worktreePath,
        branch: branch || head || 'detached',
        isMain: worktrees.length === 0,
        isBare,
        head,
      });
    }
  }

  return worktrees;
}

export function parseStatus(output: string, currentBranch: string): StatusInfo {
  const records = output.includes('\0')
    ? output.split('\0')
    : output.replace(/\r\n/g, '\n').split('\n');
  const modified = new Set<string>();
  const staged = new Set<string>();
  const untracked = new Set<string>();
  let ahead = 0;
  let behind = 0;
  let branch = currentBranch;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? '';
    if (!record) {
      continue;
    }

    if (record.startsWith('# branch.head ')) {
      const parsedBranch = record.slice('# branch.head '.length).trim();
      if (parsedBranch && parsedBranch !== '(detached)') {
        branch = parsedBranch;
      }
      continue;
    }

    if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match) {
        ahead = Number.parseInt(match[1] ?? '0', 10);
        behind = Number.parseInt(match[2] ?? '0', 10);
      }
      continue;
    }

    if (record.startsWith('? ')) {
      untracked.add(record.slice(2));
      continue;
    }

    const type = record[0];
    if (type !== '1' && type !== '2' && type !== 'u') {
      continue;
    }

    const fields = record.split(' ');
    const xy = fields[1] ?? '..';
    const pathIndex = type === '1' ? 8 : type === '2' ? 9 : 10;
    const file = fields.slice(pathIndex).join(' ');
    if (!file) {
      continue;
    }

    if (xy[0] !== '.' && xy[0] !== '?') {
      staged.add(file);
    }
    if (xy[1] !== '.' && xy[1] !== '?') {
      modified.add(file);
    }

    if (type === '2' && output.includes('\0')) {
      index += 1;
    }
  }

  return {
    branch,
    isClean: modified.size === 0 && staged.size === 0 && untracked.size === 0,
    modified: [...modified],
    staged: [...staged],
    untracked: [...untracked],
    ahead,
    behind,
  };
}

export function parseBranchList(output: string): BranchInfo[] {
  const branches: BranchInfo[] = [];

  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    if (!line) {
      continue;
    }
    const [
      fullRef = '',
      shortName = '',
      upstream = '',
      head = '',
      tracking = '',
    ] = line.split('\0');
    if (
      !fullRef ||
      !shortName ||
      (fullRef.startsWith('refs/remotes/') && fullRef.endsWith('/HEAD'))
    ) {
      continue;
    }

    const aheadMatch = /\bahead (\d+)\b/.exec(tracking);
    const behindMatch = /\bbehind (\d+)\b/.exec(tracking);
    branches.push({
      name: shortName,
      isRemote: fullRef.startsWith('refs/remotes/'),
      isCurrent: head.trim() === '*',
      upstream: upstream || undefined,
      ahead: aheadMatch ? Number.parseInt(aheadMatch[1] ?? '0', 10) : 0,
      behind: behindMatch ? Number.parseInt(behindMatch[1] ?? '0', 10) : 0,
    });
  }

  return branches;
}
