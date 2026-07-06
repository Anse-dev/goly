/**
 * Worktree domain model and service
 */

import * as vscode from 'vscode';
import { GitClient, StatusInfo } from '../git/client.js';
import { Result, EventBus, debounce } from '../core/types.js';
import { logger } from '../core/logger.js';
import { getConfig } from '../core/config.js';

export interface WorktreeInfo {
  id: string;
  path: string;
  name: string;
  branch: string;
  isMain: boolean;
  status: StatusInfo;
  lastActivity: number;
  ports: number[];
  processes: ProcessInfo[];
  hasAgent: boolean;
  agentName?: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  port?: number;
}

export interface WorktreeCreated {
  worktree: WorktreeInfo;
  opened: boolean;
}

// Internal events
export interface WorktreeEvents {
  'worktree:created': WorktreeInfo;
  'worktree:removed': string;
  'worktree:updated': WorktreeInfo;
  'worktree:active': WorktreeInfo;
}

export class WorktreeService {
  private git: GitClient;
  private worktrees = new Map<string, WorktreeInfo>();
  private eventBus = new EventBus<WorktreeEvents>();
  private refreshDebounced: (() => void) & { cancel(): void };
  private watcher: vscode.FileSystemWatcher | null = null;
  private config = getConfig();

  constructor(repoPath: string) {
    this.git = new GitClient(repoPath);
    this.refreshDebounced = debounce(() => this.refresh(), 500);
  }

  /**
   * Initialize service and start watching
   */
  async init(): Promise<Result<WorktreeInfo[]>> {
    const isRepo = await this.git.isRepository();
    if (!isRepo) {
      return { ok: false, error: new Error('Not a git repository') };
    }

    const result = await this.list();
    if (result.ok) {
      this.setupWatcher();
    }
    return result;
  }

  /**
   * List all worktrees with status
   */
  async list(): Promise<Result<WorktreeInfo[]>> {
    const worktreesResult = await this.git.listWorktrees();
    if (!worktreesResult.ok) {
      return worktreesResult;
    }

    const worktrees: WorktreeInfo[] = [];

    for (const wt of worktreesResult.value) {
      // Get status for each worktree
      const worktreeGit = new GitClient(wt.path);
      const statusResult = await worktreeGit.getStatus();
      
      const status = statusResult.ok 
        ? statusResult.value 
        : { branch: wt.branch, isClean: true, modified: [], staged: [], untracked: [], ahead: 0, behind: 0 };

      const info: WorktreeInfo = {
        id: this.generateId(wt.path),
        path: wt.path,
        name: this.getName(wt.path),
        branch: wt.branch,
        isMain: wt.isMain,
        status,
        lastActivity: Date.now(),
        ports: [],
        processes: [],
        hasAgent: false,
      };

      worktrees.push(info);
      this.worktrees.set(wt.path, info);
    }

    return { ok: true, value: worktrees };
  }

  /**
   * Create a new worktree
   */
  async create(
    branch: string,
    path: string,
    createBranch = false,
    openInNewWindow = true
  ): Promise<Result<WorktreeCreated>> {
    logger.info(`Creating worktree: ${branch} at ${path}`);

    const createResult = await this.git.createWorktree(path, branch, createBranch);
    if (!createResult.ok) {
      return createResult;
    }

    // Refresh to get the new worktree info
    await this.refresh();

    const worktree = this.worktrees.get(path);
    if (!worktree) {
      return { ok: false, error: new Error('Worktree not found after creation') };
    }

    this.eventBus.emit('worktree:created', worktree);

    // Open in new window if configured
    if (openInNewWindow || this.config.autoOpenInNewWindow) {
      try {
        await vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(path),
          { newWindow: true }
        );
      } catch (e) {
        logger.warn('Failed to open new window', e);
      }
    }

    return {
      ok: true,
      value: { worktree, opened: openInNewWindow },
    };
  }

  /**
   * Remove a worktree
   */
  async remove(path: string, deleteBranch = false): Promise<Result<void>> {
    logger.info(`Removing worktree: ${path}, deleteBranch: ${deleteBranch}`);

    const result = await this.git.removeWorktree(path, false);
    if (!result.ok) {
      return result;
    }

    // If deleteBranch is requested, we could implement branch deletion here
    // For safety, we don't auto-delete branches

    this.worktrees.delete(path);
    this.eventBus.emit('worktree:removed', path);
    
    return { ok: true, value: undefined as void };
  }

  /**
   * Refresh all worktrees
   */
  async refresh(): Promise<Result<void>> {
    const result = await this.list();
    if (!result.ok) return result;
    
    // Emit update events for changed worktrees
    for (const wt of result.value) {
      this.eventBus.emit('worktree:updated', wt);
    }
    
    return { ok: true, value: undefined as void };
  }

  /**
   * Get a specific worktree
   */
  get(path: string): WorktreeInfo | undefined {
    return this.worktrees.get(path);
  }

  /**
   * Get all worktrees
   */
  getAll(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }

  /**
   * Get worktree by branch name
   */
  getByBranch(branch: string): WorktreeInfo | undefined {
    return Array.from(this.worktrees.values()).find(w => w.branch === branch);
  }

  /**
   * Subscribe to worktree events
   */
  on<K extends keyof WorktreeEvents>(
    event: K,
    handler: (data: WorktreeEvents[K]) => void
  ): vscode.Disposable {
    return this.eventBus.on(event, handler);
  }

  /**
   * Update process/port info for a worktree
   */
  updateActivity(path: string, ports: number[], processes: ProcessInfo[], hasAgent = false, agentName?: string): void {
    const worktree = this.worktrees.get(path);
    if (worktree) {
      worktree.ports = ports;
      worktree.processes = processes;
      worktree.hasAgent = hasAgent;
      worktree.agentName = agentName;
      worktree.lastActivity = Date.now();
      this.eventBus.emit('worktree:updated', worktree);
    }
  }

  /**
   * Setup file system watcher
   */
  private setupWatcher(): void {
    if (this.watcher) {
      this.watcher.dispose();
    }

    if (!this.config.autoRefresh) return;

    this.watcher = vscode.workspace.createFileSystemWatcher('**/.git/worktrees');
    this.watcher.onDidChange(() => this.refreshDebounced());
    this.watcher.onDidCreate(() => this.refreshDebounced());
    this.watcher.onDidDelete(() => this.refreshDebounced());
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.refreshDebounced.cancel();
    this.watcher?.dispose();
  }

  private generateId(path: string): string {
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      hash = ((hash << 5) - hash) + path.charCodeAt(i);
      hash = hash & hash;
    }
    return `wt_${Math.abs(hash).toString(36)}`;
  }

  private getName(path: string): string {
    return path.split('/').pop() || 'worktree';
  }
}
