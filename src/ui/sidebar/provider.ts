/**
 * Tree view showing worktrees and their live activity.
 */

import * as vscode from 'vscode';
import { getConfig, onConfigChange } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import { ProcessInspector } from '../../ports/inspector.js';
import type { WorktreeInfo, WorktreeService } from '../../worktrees/service.js';

export class GolyTreeProvider
  implements vscode.TreeDataProvider<TreeItem>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<
    TreeItem | undefined | void
  >();
  private readonly processInspector = new ProcessInspector();
  private readonly subscriptions: vscode.Disposable[] = [];
  private scanTimer: NodeJS.Timeout | null = null;
  private worktrees: WorktreeInfo[];
  private refreshing = false;
  private scanning = false;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly worktreeService: WorktreeService) {
    this.worktrees = worktreeService.getAll();
    this.subscriptions.push(
      this.worktreeService.on('worktree:updated', (worktree) => {
        const index = this.worktrees.findIndex(
          (candidate) => candidate.id === worktree.id,
        );
        if (index >= 0) {
          this.worktrees[index] = worktree;
        } else {
          this.worktrees.push(worktree);
        }
        this.changeEmitter.fire();
      }),
      this.worktreeService.on('worktree:created', (worktree) => {
        if (!this.worktrees.some((candidate) => candidate.id === worktree.id)) {
          this.worktrees.push(worktree);
        }
        this.changeEmitter.fire();
      }),
      this.worktreeService.on('worktree:removed', (worktreePath) => {
        this.worktrees = this.worktrees.filter(
          (worktree) => worktree.path !== worktreePath,
        );
        this.changeEmitter.fire();
      }),
      onConfigChange(() => this.scheduleBackgroundScan()),
    );

    this.scheduleBackgroundScan();
    void this.scanActivity();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) {
      this.worktrees = this.worktreeService.getAll();
      if (this.worktrees.length === 0) {
        return [
          new TreeItem(
            'No worktrees found',
            vscode.TreeItemCollapsibleState.None,
            'empty',
          ),
        ];
      }
      return this.worktrees.map((worktree) =>
        this.createWorktreeItem(worktree),
      );
    }

    if (
      (element.contextValue === 'worktree' ||
        element.contextValue === 'mainWorktree') &&
      element.worktree
    ) {
      return this.createWorktreeDetailItems(element.worktree);
    }
    return [];
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      return;
    }
    this.refreshing = true;
    try {
      const result = await this.worktreeService.refresh();
      if (!result.ok) {
        throw result.error;
      }
      this.worktrees = this.worktreeService.getAll();
      await this.scanActivity();
    } catch (error) {
      logger.error('Could not refresh Goly view', error);
      throw error;
    } finally {
      this.refreshing = false;
      this.changeEmitter.fire();
    }
  }

  dispose(): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.changeEmitter.dispose();
  }

  private createWorktreeItem(worktree: WorktreeInfo): TreeItem {
    const item = new TreeItem(
      this.formatWorktreeLabel(worktree),
      vscode.TreeItemCollapsibleState.Collapsed,
      worktree.isMain ? 'mainWorktree' : 'worktree',
    );
    item.worktree = worktree;
    item.iconPath = this.getStatusIcon(worktree);
    item.tooltip = this.formatTooltip(worktree);
    return item;
  }

  private createWorktreeDetailItems(worktree: WorktreeInfo): TreeItem[] {
    const items = [
      new TreeItem(
        `$(git-branch) ${worktree.branch}`,
        vscode.TreeItemCollapsibleState.None,
        'worktreeInfo',
      ),
    ];
    if (worktree.status.statusError) {
      items.push(
        new TreeItem(
          `$(warning) Git status unavailable`,
          vscode.TreeItemCollapsibleState.None,
          'worktreeInfo',
        ),
      );
    }
    const statusParts: string[] = [];
    if (worktree.status.ahead > 0) {
      statusParts.push(`↑${worktree.status.ahead}`);
    }
    if (worktree.status.behind > 0) {
      statusParts.push(`↓${worktree.status.behind}`);
    }
    if (worktree.status.modified.length > 0) {
      statusParts.push(`~${worktree.status.modified.length}`);
    }
    if (worktree.status.staged.length > 0) {
      statusParts.push(`+${worktree.status.staged.length}`);
    }
    if (worktree.status.untracked.length > 0) {
      statusParts.push(`?${worktree.status.untracked.length}`);
    }
    if (statusParts.length > 0) {
      items.push(
        new TreeItem(
          `$(diff) ${statusParts.join(' ')}`,
          vscode.TreeItemCollapsibleState.None,
          'worktreeInfo',
        ),
      );
    }

    items.push(
      new TreeItem(
        `$(folder) ${worktree.path}`,
        vscode.TreeItemCollapsibleState.None,
        'worktreeInfo',
      ),
    );

    if (worktree.ports.length > 0) {
      items.push(
        new TreeItem(
          `$(radio-tower) ${worktree.ports.map((port) => `:${port}`).join(' ')}`,
          vscode.TreeItemCollapsibleState.None,
          'worktreeInfo',
        ),
      );
    }
    if (worktree.hasAgent && worktree.agentName) {
      items.push(
        new TreeItem(
          `$(hubot) ${worktree.agentName}`,
          vscode.TreeItemCollapsibleState.None,
          'worktreeInfo',
        ),
      );
    }
    for (const process of worktree.processes.slice(0, 5)) {
      items.push(
        new TreeItem(
          `$(gear) ${process.name}${process.port ? `:${process.port}` : ''}`,
          vscode.TreeItemCollapsibleState.None,
          'worktreeProcess',
        ),
      );
    }
    items.push(
      new TreeItem(
        `$(clock) ${this.formatTimeAgo(worktree.lastActivity)}`,
        vscode.TreeItemCollapsibleState.None,
        'worktreeInfo',
      ),
    );
    return items;
  }

  private formatWorktreeLabel(worktree: WorktreeInfo): string {
    const parts = [worktree.name];
    if (!worktree.isMain) {
      parts.push(`(${worktree.branch})`);
    }
    if (worktree.status.ahead > 0 || worktree.status.behind > 0) {
      parts.push(
        `${worktree.status.ahead > 0 ? `↑${worktree.status.ahead}` : ''}` +
          `${worktree.status.behind > 0 ? `↓${worktree.status.behind}` : ''}`,
      );
    }

    const changedFiles = new Set([
      ...worktree.status.modified,
      ...worktree.status.staged,
      ...worktree.status.untracked,
    ]);
    if (changedFiles.size > 0) {
      parts.push(`~${changedFiles.size}`);
    }
    if (worktree.ports.length > 0) {
      parts.push(`:${worktree.ports[0]}`);
    }
    if (worktree.hasAgent) {
      parts.push('$(hubot)');
    }
    if (worktree.status.statusError) {
      parts.push('$(warning)');
    }
    return parts.join(' ');
  }

  private formatTooltip(worktree: WorktreeInfo): string {
    const lines = [
      worktree.name,
      `Branch: ${worktree.branch}`,
      `Path: ${worktree.path}`,
    ];
    if (worktree.status.statusError) {
      lines.push(`Git status unavailable: ${worktree.status.statusError}`);
    }
    if (!worktree.status.isClean) {
      lines.push(
        `${worktree.status.modified.length} modified`,
        `${worktree.status.staged.length} staged`,
        `${worktree.status.untracked.length} untracked`,
      );
    }
    if (worktree.ports.length > 0) {
      lines.push(`Ports: ${worktree.ports.join(', ')}`);
    }
    if (worktree.agentName) {
      lines.push(`Agent: ${worktree.agentName}`);
    }
    return lines.join('\n');
  }

  private getStatusIcon(worktree: WorktreeInfo): vscode.ThemeIcon {
    if (worktree.isMain) {
      return new vscode.ThemeIcon('home');
    }
    if (worktree.status.statusError) {
      return new vscode.ThemeIcon(
        'warning',
        new vscode.ThemeColor('problemsWarningIcon.foreground'),
      );
    }
    if (!worktree.status.isClean) {
      return new vscode.ThemeIcon(
        'circle-filled',
        new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
      );
    }
    return new vscode.ThemeIcon(
      'circle-outline',
      new vscode.ThemeColor('testing.iconPassed'),
    );
  }

  private formatTimeAgo(timestamp: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
    if (seconds < 60) {
      return 'just now';
    }
    if (seconds < 3_600) {
      return `${Math.floor(seconds / 60)}m ago`;
    }
    if (seconds < 86_400) {
      return `${Math.floor(seconds / 3_600)}h ago`;
    }
    return `${Math.floor(seconds / 86_400)}d ago`;
  }

  private async scanActivity(): Promise<void> {
    if (this.scanning || this.worktrees.length === 0) {
      return;
    }
    this.scanning = true;
    try {
      const activities = await this.processInspector.inspectPaths(
        this.worktrees.map((worktree) => worktree.path),
      );
      for (const worktree of this.worktrees) {
        const activity = activities.get(worktree.path);
        if (!activity) {
          continue;
        }
        this.worktreeService.updateActivity(
          worktree.path,
          activity.ports,
          activity.processes,
          activity.hasAgent,
          activity.agentName,
        );
      }
    } catch (error) {
      logger.debug('Could not scan worktree activity', error);
    } finally {
      this.scanning = false;
    }
  }

  private scheduleBackgroundScan(): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
    }
    const config = getConfig();
    if (!config.autoRefresh || config.refreshInterval <= 0) {
      this.scanTimer = null;
      return;
    }

    const interval = Math.max(5_000, config.refreshInterval);
    this.scanTimer = setTimeout(() => {
      void this.runBackgroundScan();
    }, interval);
  }

  private async runBackgroundScan(): Promise<void> {
    await this.scanActivity();
    this.changeEmitter.fire();
    this.scheduleBackgroundScan();
  }
}

export class TreeItem extends vscode.TreeItem {
  worktree?: WorktreeInfo;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
  }
}
