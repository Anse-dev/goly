import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';
import { GitClient } from '../git/client.js';
import {
  parseBranchList,
  parseStatus,
  parseWorktreeList,
} from '../git/parsers.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('Git parsers', () => {
  it('parses NUL-delimited worktrees and identifies only the first as main', () => {
    const output = [
      'worktree /Users/user/project',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /Users/user/project feature',
      'HEAD def456',
      'branch refs/heads/feature/payment',
      '',
      '',
    ].join('\0');

    expect(parseWorktreeList(output)).toEqual([
      {
        path: '/Users/user/project',
        branch: 'main',
        isMain: true,
        isBare: false,
        head: 'abc123',
      },
      {
        path: '/Users/user/project feature',
        branch: 'feature/payment',
        isMain: false,
        isBare: false,
        head: 'def456',
      },
    ]);
  });

  it('parses detached and bare worktrees', () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'detached',
      '',
      'worktree /bare',
      'HEAD def456',
      'bare',
      '',
      '',
    ].join('\0');
    const worktrees = parseWorktreeList(output);

    expect(worktrees[0]?.branch).toBe('detached');
    expect(worktrees[1]?.isBare).toBe(true);
  });

  it('ignores prunable worktree metadata', () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /missing',
      'HEAD def456',
      'branch refs/heads/stale',
      'prunable gitdir file points to non-existent location',
      '',
      '',
    ].join('\0');

    expect(parseWorktreeList(output)).toHaveLength(1);
  });

  it('parses clean status and branch tracking', () => {
    const output = [
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -3',
      '',
    ].join('\0');
    const status = parseStatus(output, 'fallback');

    expect(status).toMatchObject({
      branch: 'main',
      isClean: true,
      ahead: 2,
      behind: 3,
    });
  });

  it('parses staged, modified, untracked and spaced paths', () => {
    const output = [
      '1 M. N... 100644 100644 100644 aaa bbb staged file.ts',
      '1 .M N... 100644 100644 100644 aaa bbb modified file.ts',
      '? untracked file.ts',
      '',
    ].join('\0');
    const status = parseStatus(output, 'main');

    expect(status.isClean).toBe(false);
    expect(status.staged).toEqual(['staged file.ts']);
    expect(status.modified).toEqual(['modified file.ts']);
    expect(status.untracked).toEqual(['untracked file.ts']);
  });

  it('parses rename records without treating the old name as a record', () => {
    const output = [
      '2 R. N... 100644 100644 100644 aaa bbb R100 renamed file.ts',
      'old file.ts',
      '',
    ].join('\0');
    const status = parseStatus(output, 'main');

    expect(status.staged).toEqual(['renamed file.ts']);
    expect(status.modified).toEqual([]);
  });

  it('parses local and remote branches with tracking counts', () => {
    const output = [
      ['refs/heads/main', 'main', 'origin/main', '*', 'ahead 2, behind 1'].join(
        '\0',
      ),
      ['refs/remotes/origin/feature', 'origin/feature', '', ' ', ''].join('\0'),
      '',
    ].join('\n');
    const branches = parseBranchList(output);

    expect(branches).toEqual([
      {
        name: 'main',
        isRemote: false,
        isCurrent: true,
        upstream: 'origin/main',
        ahead: 2,
        behind: 1,
      },
      {
        name: 'origin/feature',
        isRemote: true,
        isCurrent: false,
        upstream: undefined,
        ahead: 0,
        behind: 0,
      },
    ]);
  });
});

describe('GitClient integration', () => {
  it('creates, lists and removes a worktree whose path contains shell characters', async () => {
    const repository = await createRepository();
    const client = new GitClient(repository);
    const worktreePath = path.join(path.dirname(repository), 'work tree;safe');
    temporaryDirectories.push(worktreePath);

    const created = await client.createWorktree(
      worktreePath,
      'feature/safe;name',
      true,
    );
    expect(created.ok).toBe(true);

    const worktrees = await client.listWorktrees();
    expect(worktrees.ok).toBe(true);
    if (worktrees.ok) {
      const canonicalWorktreePath = await fs.realpath(worktreePath);
      expect(worktrees.value).toHaveLength(2);
      expect(worktrees.value[1]).toMatchObject({
        path: canonicalWorktreePath,
        branch: 'feature/safe;name',
        isMain: false,
      });
    }

    const removed = await client.removeWorktree(worktreePath);
    expect(removed.ok).toBe(true);
    expect((await client.deleteBranch('feature/safe;name', true)).ok).toBe(
      true,
    );
  });

  it('reports real status paths and local branches', async () => {
    const repository = await createRepository();
    const client = new GitClient(repository);
    await fs.writeFile(
      path.join(repository, 'file with spaces.ts'),
      'content\n',
    );

    const status = await client.getStatus();
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value.untracked).toContain('file with spaces.ts');
    }

    const branches = await client.listBranches();
    expect(branches.ok).toBe(true);
    if (branches.ok) {
      expect(branches.value.some((branch) => branch.isCurrent)).toBe(true);
    }
  });

  it('creates a branch from an explicit review commit', async () => {
    const repository = await createRepository();
    const client = new GitClient(repository);
    const head = await client.resolveRef('HEAD');
    expect(head.ok).toBe(true);
    if (!head.ok) {
      return;
    }

    const worktreePath = path.join(path.dirname(repository), 'review worktree');
    temporaryDirectories.push(worktreePath);
    const created = await client.createWorktree(
      worktreePath,
      'review/test',
      true,
      head.value,
    );
    expect(created.ok).toBe(true);

    const reviewHead = await new GitClient(worktreePath).resolveRef('HEAD');
    expect(reviewHead).toEqual(head);

    expect((await client.removeWorktree(worktreePath)).ok).toBe(true);
    expect((await client.deleteBranch('review/test', true)).ok).toBe(true);
  });
});

async function createRepository(): Promise<string> {
  const repository = await fs.mkdtemp(path.join(tmpdir(), 'goly-git-test-'));
  temporaryDirectories.push(repository);
  await execFileAsync('git', ['init', '-b', 'main', repository]);
  await execFileAsync('git', [
    '-C',
    repository,
    'config',
    'user.email',
    'test@goly.dev',
  ]);
  await execFileAsync('git', [
    '-C',
    repository,
    'config',
    'user.name',
    'Goly Test',
  ]);
  await fs.writeFile(path.join(repository, 'README.md'), '# test\n');
  await execFileAsync('git', ['-C', repository, 'add', 'README.md']);
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'initial']);
  return repository;
}
