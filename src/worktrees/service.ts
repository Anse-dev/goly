/**
 * Worktree domain model and orchestration.
 */

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig, onConfigChange } from '../core/config.js';
import type { GolyConfig } from '../core/config.js';
import {
  debounce,
  EventBus,
  isPathInside,
  err,
  ok,
  toError,
} from '../core/types.js';
import type { Result } from '../core/types.js';
import { logger } from '../core/logger.js';
import { GitClient } from '../git/client.js';
import type { StatusInfo } from '../git/client.js';
import type { ProcessInfo } from '../ports/inspector.js';

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

export interface WorktreeCreated {
  worktree: WorktreeInfo;
  opened: boolean;
  warnings: string[];
}

export interface CreateWorktreeOptions {
  createBranch?: boolean;
  startPoint?: string;
  openInNewWindow?: boolean;
  copyEnvironment?: boolean;
  runPostCreateCommands?: boolean;
}

export interface WorktreeEvents {
  'worktree:created': WorktreeInfo;
  'worktree:removed': string;
  'worktree:updated': WorktreeInfo;
}

const EMPTY_STATUS = (branch: string): StatusInfo => ({
  branch,
  isClean: true,
  modified: [],
  staged: [],
  untracked: [],
  ahead: 0,
  behind: 0,
});

export class WorktreeService implements vscode.Disposable {
  private readonly git: GitClient;
  private readonly eventBus = new EventBus<WorktreeEvents>((event, error) => {
    logger.error(`Worktree event handler failed (${String(event)})`, error);
  });
  private readonly refreshDebounced: (() => void) & { cancel(): void };
  private readonly configSubscription: vscode.Disposable;
  private worktrees = new Map<string, WorktreeInfo>();
  private watcher: vscode.FileSystemWatcher | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<Result<void>> | null = null;
  private config: GolyConfig = getConfig();
  private repositoryRoot: string;

  constructor(repoPath: string) {
    this.repositoryRoot = path.resolve(repoPath);
    this.git = new GitClient(this.repositoryRoot);
    this.refreshDebounced = debounce(() => {
      void this.refresh();
    }, 500);
    this.configSubscription = onConfigChange((config) => {
      this.config = config;
      this.setupAutoRefresh();
    });
  }

  async init(): Promise<Result<WorktreeInfo[]>> {
    if (!(await this.git.isRepository())) {
      return err(new Error('Not a Git repository'));
    }

    const root = await this.git.getRepositoryRoot();
    if (!root.ok) {
      return root;
    }
    this.repositoryRoot = root.value;

    const result = await this.list();
    if (result.ok) {
      this.setupAutoRefresh();
    }
    return result;
  }

  async list(): Promise<Result<WorktreeInfo[]>> {
    const worktreesResult = await this.git.listWorktrees();
    if (!worktreesResult.ok) {
      return worktreesResult;
    }

    const previous = this.worktrees;
    const entries = await Promise.all(
      worktreesResult.value
        .filter((worktree) => !worktree.isBare)
        .map(async (worktree) => {
          const worktreeGit = new GitClient(worktree.path);
          const statusResult = await worktreeGit.getStatus();
          const status = statusResult.ok
            ? statusResult.value
            : EMPTY_STATUS(worktree.branch);
          const old = previous.get(worktree.path);
          const statusChanged = old ? !statusesEqual(old.status, status) : true;

          const info: WorktreeInfo = {
            id: this.generateId(worktree.path),
            path: worktree.path,
            name: path.basename(worktree.path) || 'worktree',
            branch: worktree.branch,
            isMain: worktree.isMain,
            status,
            lastActivity: old && !statusChanged ? old.lastActivity : Date.now(),
            ports: old?.ports ?? [],
            processes: old?.processes ?? [],
            hasAgent: old?.hasAgent ?? false,
            agentName: old?.agentName,
          };
          return info;
        }),
    );

    this.worktrees = new Map(
      entries.map((worktree) => [worktree.path, worktree]),
    );
    return ok(entries);
  }

  async create(
    branch: string,
    requestedPath: string,
    options: CreateWorktreeOptions = {},
  ): Promise<Result<WorktreeCreated>> {
    const additionalWorktrees = [...this.worktrees.values()].filter(
      (worktree) => !worktree.isMain,
    );
    if (
      this.config.maxWorktrees > 0 &&
      additionalWorktrees.length >= this.config.maxWorktrees
    ) {
      return err(
        new Error(`Worktree limit reached (${this.config.maxWorktrees})`),
      );
    }

    const worktreePath = path.resolve(this.repositoryRoot, requestedPath);
    logger.info(`Creating worktree ${branch} at ${worktreePath}`);

    try {
      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    } catch (error) {
      return err(
        new Error(
          `Could not create the worktree parent directory: ${toError(error).message}`,
        ),
      );
    }

    const createResult = await this.git.createWorktree(
      worktreePath,
      branch,
      options.createBranch ?? false,
      options.startPoint,
    );
    if (!createResult.ok) {
      return createResult;
    }
    const canonicalPath = await fs
      .realpath(worktreePath)
      .catch(() => worktreePath);

    const warnings: string[] = [];
    if (options.copyEnvironment ?? true) {
      const copyResult = await this.copyEnvironmentFiles(canonicalPath);
      if (!copyResult.ok) {
        warnings.push(copyResult.error.message);
      }
    }

    if (options.runPostCreateCommands ?? true) {
      const commandsResult =
        await this.runConfiguredPostCreateCommands(canonicalPath);
      if (!commandsResult.ok) {
        warnings.push(commandsResult.error.message);
      }
    }

    const refreshResult = await this.list();
    if (!refreshResult.ok) {
      return refreshResult;
    }

    const worktree = this.worktrees.get(canonicalPath);
    if (!worktree) {
      return err(new Error('Worktree was created but could not be discovered'));
    }

    this.eventBus.emit('worktree:created', worktree);

    const shouldOpen =
      options.openInNewWindow ?? this.config.autoOpenInNewWindow;
    let opened = false;
    if (shouldOpen) {
      try {
        await vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(canonicalPath),
          { forceNewWindow: true },
        );
        opened = true;
      } catch (error) {
        const message = `Could not open the new worktree: ${toError(error).message}`;
        warnings.push(message);
        logger.warn(message);
      }
    }

    return ok({ worktree, opened, warnings });
  }

  async remove(
    worktreePath: string,
    deleteBranch = false,
    forceDeleteBranch = false,
  ): Promise<Result<void>> {
    const resolvedPath = path.resolve(worktreePath);
    const normalizedPath = await fs
      .realpath(resolvedPath)
      .catch(() => resolvedPath);
    const worktree = this.worktrees.get(normalizedPath);
    if (!worktree) {
      return err(new Error(`Unknown worktree: ${normalizedPath}`));
    }
    if (worktree.isMain) {
      return err(new Error('The main worktree cannot be removed'));
    }

    logger.info(`Removing worktree ${normalizedPath}`);
    const removeResult = await this.git.removeWorktree(normalizedPath);
    if (!removeResult.ok) {
      return removeResult;
    }

    this.worktrees.delete(normalizedPath);
    this.eventBus.emit('worktree:removed', normalizedPath);

    if (deleteBranch && worktree.branch !== 'detached') {
      const branchResult = await this.git.deleteBranch(
        worktree.branch,
        forceDeleteBranch,
      );
      if (!branchResult.ok) {
        return err(
          new Error(
            `Worktree removed, but branch "${worktree.branch}" was not deleted: ${branchResult.error.message}`,
          ),
        );
      }
    }

    return ok(undefined);
  }

  async refresh(): Promise<Result<void>> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.performRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performRefresh(): Promise<Result<void>> {
    const previousPaths = new Set(this.worktrees.keys());
    const result = await this.list();
    if (!result.ok) {
      logger.warn('Could not refresh worktrees', result.error);
      return result;
    }

    for (const worktree of result.value) {
      previousPaths.delete(worktree.path);
      this.eventBus.emit('worktree:updated', worktree);
    }
    for (const removedPath of previousPaths) {
      this.eventBus.emit('worktree:removed', removedPath);
    }

    return ok(undefined);
  }

  get(worktreePath: string): WorktreeInfo | undefined {
    return this.worktrees.get(path.resolve(worktreePath));
  }

  getAll(): WorktreeInfo[] {
    return [...this.worktrees.values()];
  }

  getByBranch(branch: string): WorktreeInfo | undefined {
    return [...this.worktrees.values()].find(
      (worktree) => worktree.branch === branch,
    );
  }

  on<K extends keyof WorktreeEvents>(
    event: K,
    handler: (data: WorktreeEvents[K]) => void,
  ): vscode.Disposable {
    return this.eventBus.on(event, handler);
  }

  updateActivity(
    worktreePath: string,
    ports: number[],
    processes: ProcessInfo[],
    hasAgent = false,
    agentName?: string,
  ): void {
    const worktree = this.worktrees.get(path.resolve(worktreePath));
    if (!worktree) {
      return;
    }

    const activityChanged =
      !numberArraysEqual(worktree.ports, ports) ||
      !processesEqual(worktree.processes, processes) ||
      worktree.hasAgent !== hasAgent ||
      worktree.agentName !== agentName;

    worktree.ports = [...ports].sort((left, right) => left - right);
    worktree.processes = processes;
    worktree.hasAgent = hasAgent;
    worktree.agentName = agentName;
    if (activityChanged) {
      worktree.lastActivity = Date.now();
    }
    if (activityChanged) {
      this.eventBus.emit('worktree:updated', worktree);
    }
  }

  async copyEnvironmentFiles(targetPath: string): Promise<Result<number>> {
    try {
      const files = new Map<string, vscode.Uri>();
      for (const pattern of this.config.envFilePatterns) {
        const matches = await vscode.workspace.findFiles(
          new vscode.RelativePattern(this.repositoryRoot, pattern),
          '**/{node_modules,.git}/**',
          1_000,
        );
        for (const uri of matches) {
          if (isPathInside(this.repositoryRoot, uri.fsPath)) {
            files.set(uri.fsPath, uri);
          }
        }
      }

      let copied = 0;
      for (const source of files.values()) {
        const relativePath = path.relative(this.repositoryRoot, source.fsPath);
        const destination = path.join(targetPath, relativePath);
        if (!isPathInside(targetPath, destination)) {
          continue;
        }
        const stat = await fs.stat(source.fsPath);
        if (!stat.isFile()) {
          continue;
        }
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source.fsPath, destination);
        copied += 1;
      }
      return ok(copied);
    } catch (error) {
      return err(
        new Error(
          `Could not copy environment files: ${toError(error).message}`,
        ),
      );
    }
  }

  dispose(): void {
    this.refreshDebounced.cancel();
    this.watcher?.dispose();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.configSubscription.dispose();
    this.eventBus.dispose();
  }

  private setupAutoRefresh(): void {
    this.watcher?.dispose();
    this.watcher = null;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!this.config.autoRefresh) {
      return;
    }

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.repositoryRoot, '.git/**'),
    );
    this.watcher.onDidChange(this.refreshDebounced);
    this.watcher.onDidCreate(this.refreshDebounced);
    this.watcher.onDidDelete(this.refreshDebounced);

    if (this.config.refreshInterval > 0) {
      this.refreshTimer = setInterval(
        () => {
          void this.refresh();
        },
        Math.max(1_000, this.config.refreshInterval),
      );
    }
  }

  private async runConfiguredPostCreateCommands(
    worktreePath: string,
  ): Promise<Result<void>> {
    if (
      !vscode.workspace.isTrusted &&
      this.config.postCreateCommands.length > 0
    ) {
      return err(
        new Error(
          'Post-create commands were skipped because the workspace is not trusted',
        ),
      );
    }

    for (const command of this.config.postCreateCommands
      .map((value) => value.trim())
      .filter(Boolean)) {
      try {
        logger.info(
          `Running post-create command in ${worktreePath}: ${command}`,
        );
        await executeConfiguredCommand(command, worktreePath);
      } catch (error) {
        return err(
          new Error(
            `Post-create command failed (${command}): ${toError(error).message}`,
          ),
        );
      }
    }
    return ok(undefined);
  }

  private generateId(worktreePath: string): string {
    let hash = 0;
    for (let index = 0; index < worktreePath.length; index += 1) {
      hash = (hash << 5) - hash + worktreePath.charCodeAt(index);
      hash |= 0;
    }
    return `wt_${Math.abs(hash).toString(36)}`;
  }
}

function executeConfiguredCommand(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5 * 60_000,
        windowsHide: true,
      },
      (error, _stdout, stderr) => {
        if (error) {
          const stderrText = stderr.trim();
          if (stderrText && !error.message.includes(stderrText)) {
            error.message = `${error.message}: ${stderrText}`;
          }
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

function statusesEqual(left: StatusInfo, right: StatusInfo): boolean {
  return (
    left.branch === right.branch &&
    left.isClean === right.isClean &&
    left.ahead === right.ahead &&
    left.behind === right.behind &&
    stringArraysEqual(left.modified, right.modified) &&
    stringArraysEqual(left.staged, right.staged) &&
    stringArraysEqual(left.untracked, right.untracked)
  );
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function numberArraysEqual(
  left: readonly number[],
  right: readonly number[],
): boolean {
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function processesEqual(
  left: readonly ProcessInfo[],
  right: readonly ProcessInfo[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((process, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      process.pid === candidate.pid &&
      process.name === candidate.name &&
      process.command === candidate.command &&
      process.cwd === candidate.cwd &&
      process.port === candidate.port
    );
  });
}
