/**
 * Goly Sidebar - TreeView Provider
 * 
 * Main cockpit view showing all worktrees with live status.
 * Format: ● feature/payment  ↑2 ↓1  ~12  :3001  🤖
 */

import * as vscode from 'vscode';
import { WorktreeInfo, WorktreeService } from '../../worktrees/service.js';
import { ProcessInspector } from '../../ports/inspector.js';
import { logger } from '../../core/logger.js';
import { withTimeout } from '../../core/types.js';

export class GolyTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  private worktrees: WorktreeInfo[] = [];
  private processInspector = new ProcessInspector();
  private refreshing = false;

  constructor(private worktreeService: WorktreeService) {
    // Subscribe to worktree updates
    this.worktreeService.on('worktree:updated', (wt) => {
      const index = this.worktrees.findIndex(w => w.id === wt.id);
      if (index >= 0) {
        this.worktrees[index] = wt;
      }
      this._onDidChangeTreeData.fire();
    });

    this.worktreeService.on('worktree:created', (wt) => {
      this.worktrees.push(wt);
      this._onDidChangeTreeData.fire();
    });

    this.worktreeService.on('worktree:removed', (path) => {
      this.worktrees = this.worktrees.filter(w => w.path !== path);
      this._onDidChangeTreeData.fire();
    });

    // Start process/port scanning
    this.startBackgroundScan();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) {
      // Root level - list worktrees
      const result = await this.worktreeService.list();
      if (!result.ok) {
        return [new TreeItem('No git repository', vscode.TreeItemCollapsibleState.None)];
      }
      this.worktrees = result.value;
      
      // Scan for processes and ports
      await this.scanActivity();
      
      if (this.worktrees.length === 0) {
        return [new TreeItem(
          'No worktrees. Run "Goly: Create Worktree" to get started.',
          vscode.TreeItemCollapsibleState.None
        )];
      }
      
      return this.worktrees.map(wt => this.createWorktreeItem(wt));
    }

    if (element.contextValue === 'worktree') {
      return this.createWorktreeDetailItems(element.worktree!);
    }

    return [];
  }

  refresh(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    
    this.worktreeService.refresh().finally(() => {
      this.refreshing = false;
      this._onDidChangeTreeData.fire();
    });
  }

  private createWorktreeItem(wt: WorktreeInfo): TreeItem {
    const label = this.formatWorktreeLabel(wt);
    const item = new TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, 'worktree');
    item.worktree = wt;
    item.iconPath = this.getStatusIcon(wt);
    item.tooltip = this.formatTooltip(wt);
    item.contextValue = 'worktree';
    
    // Add inline actions
    item.commands = [
      {
        command: 'goly.open',
        title: 'Open',
        arguments: [wt],
      },
      {
        command: 'goly.terminal',
        title: 'Terminal',
        arguments: [wt],
      },
    ];

    return item;
  }

  private createWorktreeDetailItems(wt: WorktreeInfo): TreeItem[] {
    const items: TreeItem[] = [];

    // Branch
    items.push(new TreeItem(
      `$(git-branch) ${wt.branch}`,
      vscode.TreeItemCollapsibleState.None,
      'info'
    ));

    // Status
    const statusParts: string[] = [];
    if (wt.status.ahead > 0) statusParts.push(`↑${wt.status.ahead}`);
    if (wt.status.behind > 0) statusParts.push(`↓${wt.status.behind}`);
    if (wt.status.modified.length > 0) statusParts.push(`~${wt.status.modified.length}`);
    if (wt.status.untracked.length > 0) statusParts.push(`?${wt.status.untracked.length}`);
    
    if (statusParts.length > 0) {
      items.push(new TreeItem(
        `$(diff) ${statusParts.join(' ')}`,
        vscode.TreeItemCollapsibleState.None,
        'info'
      ));
    }

    // Path
    items.push(new TreeItem(
      `$(folder) ${wt.path}`,
      vscode.TreeItemCollapsibleState.None,
      'info'
    ));

    // Ports
    if (wt.ports.length > 0) {
      items.push(new TreeItem(
        `$(port) ${wt.ports.map(p => `:${p}`).join(' ')}`,
        vscode.TreeItemCollapsibleState.None,
        'info'
      ));
    }

    // Agent
    if (wt.hasAgent && wt.agentName) {
      items.push(new TreeItem(
        `🤖 ${wt.agentName}`,
        vscode.TreeItemCollapsibleState.None,
        'info'
      ));
    }

    // Processes
    for (const proc of wt.processes.slice(0, 5)) {
      items.push(new TreeItem(
        `$(gear) ${proc.name}${proc.port ? `:${proc.port}` : ''}`,
        vscode.TreeItemCollapsibleState.None,
        'process'
      ));
    }

    // Last activity
    const ago = this.formatTimeAgo(wt.lastActivity);
    items.push(new TreeItem(
      `$(clock) ${ago}`,
      vscode.TreeItemCollapsibleState.None,
      'info'
    ));

    return items;
  }

  private formatWorktreeLabel(wt: WorktreeInfo): string {
    const parts: string[] = [wt.name];
    
    // Branch indicator
    if (!wt.isMain) {
      parts.push(`(${wt.branch})`);
    }
    
    // Ahead/behind
    if (wt.status.ahead > 0 || wt.status.behind > 0) {
      const ahead = wt.status.ahead > 0 ? `↑${wt.status.ahead}` : '';
      const behind = wt.status.behind > 0 ? `↓${wt.status.behind}` : '';
      parts.push(`${ahead}${behind}`);
    }
    
    // Modified count
    const total = wt.status.modified.length + wt.status.staged.length + wt.status.untracked.length;
    if (total > 0) {
      parts.push(`~${total}`);
    }
    
    // Port
    if (wt.ports.length > 0) {
      parts.push(`:${wt.ports[0]}`);
    }
    
    // Agent badge
    if (wt.hasAgent) {
      parts.push('🤖');
    }
    
    return parts.join(' ');
  }

  private formatTooltip(wt: WorktreeInfo): string {
    const lines = [
      `**${wt.name}**`,
      `Branch: ${wt.branch}`,
      `Path: ${wt.path}`,
      '',
    ];

    if (!wt.status.isClean) {
      if (wt.status.modified.length > 0) lines.push(`${wt.status.modified.length} modified`);
      if (wt.status.staged.length > 0) lines.push(`${wt.status.staged.length} staged`);
      if (wt.status.untracked.length > 0) lines.push(`${wt.status.untracked.length} untracked`);
    }

    if (wt.ports.length > 0) {
      lines.push(`Ports: ${wt.ports.join(', ')}`);
    }

    if (wt.hasAgent && wt.agentName) {
      lines.push(`Agent: ${wt.agentName}`);
    }

    return lines.join('\n');
  }

  private getStatusIcon(wt: WorktreeInfo): vscode.ThemeIcon {
    if (wt.isMain) {
      return new vscode.ThemeIcon('home');
    }
    if (!wt.status.isClean) {
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('editorGutter.modifiedBackground'));
    }
    return new vscode.ThemeIcon('circle', new vscode.ThemeColor('testing.icon.passed'));
  }

  private formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  private async scanActivity(): Promise<void> {
    for (const wt of this.worktrees) {
      try {
        const ports = await withTimeout(
          this.processInspector.getPortsForPath(wt.path),
          1000,
          []
        );
        
        const processes = await withTimeout(
          this.processInspector.getProcessesForPath(wt.path),
          1000,
          []
        );
        
        const agent = await withTimeout(
          this.processInspector.detectAgent(wt.path),
          1000,
          { hasAgent: false }
        );
        
        this.worktreeService.updateActivity(
          wt.path,
          ports,
          processes,
          agent.hasAgent,
          agent.agentName
        );
      } catch (e) {
        logger.debug(`Failed to scan activity for ${wt.path}`, e);
      }
    }
  }

  private startBackgroundScan(): void {
    // Scan every 10 seconds
    setInterval(async () => {
      if (this.worktrees.length > 0) {
        await this.scanActivity();
        this._onDidChangeTreeData.fire();
      }
    }, 10000);
  }
}

export class TreeItem extends vscode.TreeItem {
  worktree?: WorktreeInfo;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
  }
}
