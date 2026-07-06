/**
 * Git Client - Spawns Git CLI and parses porcelain output
 * 
 * All git operations go through this module. Parsers are pure functions
 * tested against real git output fixtures.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { Result, ok, err } from '../core/types.js';
import { logger } from '../core/logger.js';

const execAsync = promisify(exec);

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

export class GitClient {
  constructor(private cwd: string) {}

  /**
   * Run a git command and return the result
   */
  private async run(args: string[]): Promise<Result<string>> {
    const cmd = `git ${args.join(' ')}`;
    logger.debug(`Git: ${cmd}`);
    
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: this.cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 30000,
      });
      
      if (stderr && !stderr.includes('warning')) {
        logger.warn(`Git stderr: ${stderr}`);
      }
      
      return ok(stdout);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error(`Git failed: ${cmd}`, e);
      return err(new Error(error));
    }
  }

  /**
   * Check if directory is a git repository
   */
  async isRepository(): Promise<boolean> {
    const result = await this.run(['rev-parse', '--is-inside-work-tree']);
    return result.ok && result.value.trim() === 'true';
  }

  /**
   * Get repository root path
   */
  async getRepositoryRoot(): Promise<Result<string>> {
    const result = await this.run(['rev-parse', '--show-toplevel']);
    if (!result.ok) return result;
    return ok(result.value.trim());
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<Result<string>> {
    const result = await this.run(['branch', '--show-current']);
    if (!result.ok) return result;
    return ok(result.value.trim());
  }

  /**
   * Get repository information
   */
  async getRepositoryInfo(): Promise<Result<RepositoryInfo>> {
    const root = await this.getRepositoryRoot();
    if (!root.ok) return root;
    
    const branch = await this.getCurrentBranch();
    if (!branch.ok) return branch;
    
    const remotesResult = await this.run(['remote']);
    const remotes = remotesResult.ok 
      ? remotesResult.value.trim().split('\n').filter(Boolean)
      : [];

    const name = root.value.split('/').pop() || 'repository';
    
    return ok({
      name,
      path: this.cwd,
      root: root.value,
      currentBranch: branch.value,
      remotes,
    });
  }

  /**
   * List all worktrees using porcelain output
   */
  async listWorktrees(): Promise<Result<Worktree[]>> {
    const result = await this.run(['worktree', 'list', '--porcelain']);
    if (!result.ok) return result;
    
    return ok(parseWorktreeList(result.value));
  }

  /**
   * Get status using porcelain v2 format
   */
  async getStatus(): Promise<Result<StatusInfo>> {
    const branch = await this.getCurrentBranch();
    if (!branch.ok) return branch;

    const result = await this.run(['status', '--porcelain=v2', '-b']);
    if (!result.ok) return result;
    
    return ok(parseStatus(result.value, branch.value));
  }

  /**
   * List all branches
   */
  async listBranches(remote = false): Promise<Result<BranchInfo[]>> {
    const flags = remote ? ['-a'] : ['-l'];
    const result = await this.run([
      'branch',
      ...flags,
      '--format=%(refname:short)|%(upstream:short)|%(HEAD)|%(aheadbehind)',
    ]);
    
    if (!result.ok) return result;
    return ok(parseBranchList(result.value));
  }

  /**
   * Fetch from remote
   */
  async fetch(remote = 'origin', ref?: string): Promise<Result<void>> {
    const args = ref 
      ? ['fetch', remote, ref]
      : ['fetch', remote];
    
    const result = await this.run(args);
    if (!result.ok) return result;
    return ok(undefined as void);
  }

  /**
   * Create a new worktree
   */
  async createWorktree(
    path: string,
    branch: string,
    createBranch = false,
    upstream?: string
  ): Promise<Result<void>> {
    const args = ['worktree', 'add'];
    
    if (createBranch) {
      args.push('-b', branch);
    }
    
    args.push(path, upstream || branch);
    
    const result = await this.run(args);
    if (!result.ok) return result;
    return ok(undefined as void);
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(path: string, force = false): Promise<Result<void>> {
    const args = force 
      ? ['worktree', 'remove', '--force', path]
      : ['worktree', 'remove', path];
    
    const result = await this.run(args);
    if (!result.ok) return result;
    return ok(undefined as void);
  }

  /**
   * Prune stale worktree references
   */
  async pruneWorktrees(): Promise<Result<void>> {
    const result = await this.run(['worktree', 'prune']);
    if (!result.ok) return result;
    return ok(undefined as void);
  }

  /**
   * Get remote URL
   */
  async getRemoteUrl(remote = 'origin'): Promise<Result<string>> {
    const result = await this.run(['remote', 'get-url', remote]);
    if (!result.ok) return result;
    return ok(result.value.trim());
  }
}

/**
 * Parse git worktree list --porcelain output
 */
function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  const entries = output.split(/\n\n(?=worktree )/);

  for (const entry of entries) {
    if (!entry.trim()) continue;

    const lines = entry.split('\n');
    let path = '';
    let branch = '';
    let isMain = false;
    let isBare = false;
    let head = '';

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice(9).trim();
      } else if (line.startsWith('HEAD ')) {
        head = line.slice(5).trim();
        // Main worktree has HEAD pointing directly to commit
        isMain = !head.includes('worktrees');
      } else if (line.startsWith('branch ')) {
        branch = line.slice(7).trim();
      } else if (line.startsWith('bare ')) {
        isBare = line.slice(5).trim() === 'true';
      }
    }

    if (path) {
      worktrees.push({
        path,
        branch: branch || head || 'detached',
        isMain,
        isBare,
        head,
      });
    }
  }

  return worktrees;
}

/**
 * Parse git status --porcelain=v2 -b output
 */
function parseStatus(output: string, currentBranch: string): StatusInfo {
  const lines = output.split('\n');
  const modified: string[] = [];
  const staged: string[] = [];
  const untracked: string[] = [];
  
  let ahead = 0;
  let behind = 0;
  let isClean = true;

  for (const line of lines) {
    // Parse staged changes (1.2) or untracked (??)
    if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('? ')) {
      isClean = false;
      const file = line.slice(3).split(' ')[2] || line.slice(3);
      
      if (line.startsWith('?')) {
        untracked.push(file);
      } else {
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        
        if (indexStatus !== '.' && indexStatus !== '?') {
          staged.push(file);
        }
        if (workTreeStatus !== '.' && workTreeStatus !== '?') {
          modified.push(file);
        }
      }
    }
    
    // Parse ahead/behind from branch line
    if (line.startsWith('# branch.ab ')) {
      const parts = line.slice(12).trim().split(' ');
      for (const part of parts) {
        if (part.startsWith('+')) {
          ahead = parseInt(part.slice(1), 10) || 0;
        } else if (part.startsWith('-')) {
          behind = parseInt(part.slice(1), 10) || 0;
        }
      }
    }
  }

  return {
    branch: currentBranch,
    isClean,
    modified: [...new Set(modified)],
    staged: [...new Set(staged)],
    untracked: [...new Set(untracked)],
    ahead,
    behind,
  };
}

/**
 * Parse git branch list output
 */
function parseBranchList(output: string): BranchInfo[] {
  const branches: BranchInfo[] = [];
  
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    
    const [name, upstream, head, aheadBehind] = line.split('|');
    if (!name) continue;
    
    branches.push({
      name: name.trim(),
      isRemote: name.includes('remotes/') || name.startsWith('origin/'),
      isCurrent: head === '*',
      upstream: upstream || undefined,
    });
  }
  
  return branches;
}
