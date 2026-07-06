/**
 * Git client backed by execFile.
 *
 * Arguments are passed directly to Git without a shell. Parsers use Git's
 * machine-readable, NUL-delimited formats so paths containing whitespace are
 * preserved.
 */

import { execFile } from 'child_process';
import * as path from 'path';
import { err, ok, toError } from '../core/types.js';
import type { Result } from '../core/types.js';
import { logger } from '../core/logger.js';
import { parseBranchList, parseStatus, parseWorktreeList } from './parsers.js';

export { parseBranchList, parseStatus, parseWorktreeList } from './parsers.js';

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

export interface Worktree {
  path: string;
  branch: string;
  isMain: boolean;
  isBare: boolean;
  head: string;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export interface StatusInfo {
  branch: string;
  isClean: boolean;
  modified: string[];
  staged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface RepositoryInfo {
  name: string;
  path: string;
  root: string;
  currentBranch: string;
  remotes: string[];
}

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

export class GitClient {
  constructor(private readonly cwd: string) {}

  private async run(args: readonly string[]): Promise<Result<string>> {
    logger.debug('Git command', ['git', ...args]);

    try {
      const { stdout, stderr } = await executeFile('git', args, this.cwd);
      if (stderr.trim() && !stderr.toLowerCase().includes('warning')) {
        logger.warn('Git stderr', stderr.trim());
      }
      return ok(stdout);
    } catch (error) {
      const cause = toError(error);
      logger.error(`Git command failed in ${this.cwd}`, cause);
      return err(cause);
    }
  }

  async isRepository(): Promise<boolean> {
    const result = await this.run(['rev-parse', '--is-inside-work-tree']);
    return result.ok && result.value.trim() === 'true';
  }

  async getRepositoryRoot(): Promise<Result<string>> {
    const result = await this.run(['rev-parse', '--show-toplevel']);
    return result.ok ? ok(result.value.trim()) : result;
  }

  async getCurrentBranch(): Promise<Result<string>> {
    const result = await this.run(['branch', '--show-current']);
    return result.ok ? ok(result.value.trim() || 'detached') : result;
  }

  async getRepositoryInfo(): Promise<Result<RepositoryInfo>> {
    const [root, branch, remotesResult] = await Promise.all([
      this.getRepositoryRoot(),
      this.getCurrentBranch(),
      this.run(['remote']),
    ]);

    if (!root.ok) {
      return root;
    }
    if (!branch.ok) {
      return branch;
    }

    return ok({
      name: path.basename(root.value) || 'repository',
      path: this.cwd,
      root: root.value,
      currentBranch: branch.value,
      remotes: remotesResult.ok
        ? remotesResult.value
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
    });
  }

  async listWorktrees(): Promise<Result<Worktree[]>> {
    const result = await this.run(['worktree', 'list', '--porcelain', '-z']);
    return result.ok ? ok(parseWorktreeList(result.value)) : result;
  }

  async getStatus(): Promise<Result<StatusInfo>> {
    const branch = await this.getCurrentBranch();
    if (!branch.ok) {
      return branch;
    }

    const result = await this.run([
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
    ]);
    return result.ok ? ok(parseStatus(result.value, branch.value)) : result;
  }

  async listBranches(includeRemotes = false): Promise<Result<BranchInfo[]>> {
    const refs = includeRemotes
      ? ['refs/heads', 'refs/remotes']
      : ['refs/heads'];
    const result = await this.run([
      'for-each-ref',
      '--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(HEAD)%00%(upstream:track,nobracket)',
      ...refs,
    ]);

    return result.ok ? ok(parseBranchList(result.value)) : result;
  }

  async validateBranchName(branch: string): Promise<boolean> {
    if (!branch.trim()) {
      return false;
    }
    const result = await this.run(['check-ref-format', '--branch', branch]);
    return result.ok;
  }

  async fetch(remote = 'origin', ref?: string): Promise<Result<void>> {
    const args = ['fetch', '--', remote];
    if (ref) {
      args.push(ref);
    }
    const result = await this.run(args);
    return result.ok ? ok(undefined) : result;
  }

  async resolveRef(ref: string): Promise<Result<string>> {
    const result = await this.run([
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${ref}^{commit}`,
    ]);
    return result.ok ? ok(result.value.trim()) : result;
  }

  async createWorktree(
    worktreePath: string,
    branch: string,
    createBranch = false,
    startPoint?: string,
  ): Promise<Result<void>> {
    if (!(await this.validateBranchName(branch))) {
      return err(new Error(`Invalid branch name: ${branch}`));
    }

    const args = ['worktree', 'add'];
    if (createBranch) {
      args.push('-b', branch);
    }
    args.push('--', worktreePath);

    if (startPoint) {
      args.push(startPoint);
    } else if (!createBranch) {
      args.push(branch);
    }

    const result = await this.run(args);
    return result.ok ? ok(undefined) : result;
  }

  async removeWorktree(
    worktreePath: string,
    force = false,
  ): Promise<Result<void>> {
    const args = ['worktree', 'remove'];
    if (force) {
      args.push('--force');
    }
    args.push('--', worktreePath);
    const result = await this.run(args);
    return result.ok ? ok(undefined) : result;
  }

  async deleteBranch(branch: string, force = false): Promise<Result<void>> {
    const normalized = branch.replace(/^refs\/heads\//, '');
    if (!(await this.validateBranchName(normalized))) {
      return err(new Error(`Invalid branch name: ${branch}`));
    }

    const result = await this.run([
      'branch',
      force ? '-D' : '-d',
      '--',
      normalized,
    ]);
    return result.ok ? ok(undefined) : result;
  }

  async pruneWorktrees(): Promise<Result<void>> {
    const result = await this.run(['worktree', 'prune']);
    return result.ok ? ok(undefined) : result;
  }

  async getRemoteUrl(remote = 'origin'): Promise<Result<string>> {
    const result = await this.run(['remote', 'get-url', '--', remote]);
    return result.ok ? ok(result.value.trim()) : result;
  }

  async diff(baseRef: string, compareRef: string): Promise<Result<string>> {
    const result = await this.run([
      'diff',
      '--no-ext-diff',
      '--no-color',
      `${baseRef}...${compareRef}`,
      '--',
    ]);
    return result.ok ? ok(result.value) : result;
  }
}

function executeFile(
  file: string,
  args: readonly string[],
  cwd: string,
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: GIT_MAX_BUFFER,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const stderrText = String(stderr).trim();
          if (stderrText && !error.message.includes(stderrText)) {
            error.message = `${error.message}: ${stderrText}`;
          }
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}
