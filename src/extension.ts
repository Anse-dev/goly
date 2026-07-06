/**
 * Goly Extension - Main Entry Point
 * 
 * Orchestrates all services and registers commands/views.
 */

import * as vscode from 'vscode';
import { GitClient } from './git/client.js';
import { WorktreeService, WorktreeInfo } from './worktrees/service.js';
import { ReviewService } from './review/service.js';
import { SnapshotService } from './snapshots/service.js';
import { GolyTreeProvider } from './ui/sidebar/provider.js';
import { logger } from './core/logger.js';
import { getConfig } from './core/config.js';
import { expandTilde, getBasename } from './core/types.js';

let worktreeService: WorktreeService;
let reviewService: ReviewService;
let snapshotService: SnapshotService;
let treeProvider: GolyTreeProvider;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info('Goly activating...');
  const startTime = Date.now();

  try {
    // Get workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      logger.warn('No workspace folder open');
      return;
    }

    const repoPath = workspaceFolder.uri.fsPath;

    // Initialize Git client and check repository
    const git = new GitClient(repoPath);
    const isRepo = await git.isRepository();
    if (!isRepo) {
      logger.warn('Not a git repository');
      return;
    }

    // Initialize services
    worktreeService = new WorktreeService(repoPath);
    await worktreeService.init();

    reviewService = new ReviewService(git, worktreeService);
    snapshotService = new SnapshotService(context.globalState);

    // Register tree view
    treeProvider = new GolyTreeProvider(worktreeService);
    vscode.window.registerTreeDataProvider('goly.sidebar', treeProvider);

    // Register commands
    registerCommands(context);

    // Create status bar
    createStatusBar(context);

    // Setup welcome view for empty state
    setupWelcomeView();

    const elapsed = Date.now() - startTime;
    logger.info(`Goly activated in ${elapsed}ms`);
    
    // Show activation message
    vscode.window.showInformationMessage(`Goly activated (${elapsed}ms)`);
  } catch (e) {
    logger.error('Goly activation failed', e);
    throw e;
  }
}

export function deactivate(): void {
  logger.info('Goly deactivating...');
  worktreeService?.dispose();
  statusBarItem?.dispose();
}

function registerCommands(context: vscode.ExtensionContext): void {
  // Refresh
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.refresh', async () => {
      treeProvider.refresh();
    })
  );

  // Create worktree
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.create', async () => {
      await createWorktree();
    })
  );

  // Remove worktree
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.remove', async (wt?: WorktreeInfo) => {
      if (!wt) {
        const selected = await vscode.window.showQuickPick(
          worktreeService.getAll().map(w => ({
            label: w.name,
            description: w.branch,
            worktree: w,
          })),
          { placeHolder: 'Select worktree to remove' }
        );
        if (!selected) return;
        wt = selected.worktree;
      }

      const config = getConfig();
      if (config.confirmBeforeDelete) {
        const choice = await vscode.window.showWarningMessage(
          `Delete worktree "${wt.name}"?`,
          { modal: true },
          'Delete Worktree Only',
          config.confirmBeforeDeleteBranch ? 'Delete Worktree + Branch' : undefined,
          'Cancel'
        );
        
        if (!choice || choice === 'Cancel') return;
        if (choice === 'Delete Worktree + Branch') {
          await worktreeService.remove(wt.path, true);
        } else {
          await worktreeService.remove(wt.path, false);
        }
      }
    })
  );

  // Open in new window
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.open', async (wt?: WorktreeInfo) => {
      if (!wt) return;
      await vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.file(wt.path),
        { newWindow: true }
      );
    })
  );

  // Open terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.terminal', async (wt?: WorktreeInfo) => {
      if (!wt) {
        const selected = await vscode.window.showQuickPick(
          worktreeService.getAll().map(w => ({
            label: w.name,
            worktree: w,
          }))
        );
        if (!selected) return;
        wt = selected.worktree;
      }

      const terminal = vscode.window.createTerminal({
        name: `Goly: ${wt.name}`,
        cwd: wt.path,
      });
      terminal.show();
    })
  );

  // Review mode
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.review', async () => {
      const ref = await vscode.window.showInputBox({
        prompt: 'Enter branch or PR reference to review',
        placeHolder: 'e.g., origin/feature-xyz or refs/pull/123/head',
      });

      if (!ref) return;

      const result = await reviewService.startReview(ref);
      if (!result.ok) {
        vscode.window.showErrorMessage(`Failed to start review: ${result.error.message}`);
      }
    })
  );

  // Save snapshot
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.snapshot', async (wt?: WorktreeInfo) => {
      if (!wt) {
        const selected = await vscode.window.showQuickPick(
          worktreeService.getAll().map(w => ({
            label: w.name,
            description: w.branch,
            worktree: w,
          }))
        );
        if (!selected) return;
        wt = selected.worktree;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Enter snapshot name',
        placeHolder: 'e.g., my-feature-context',
      });

      if (!name) return;

      await snapshotService.save(name, wt.path, wt.branch);
      vscode.window.showInformationMessage(`Snapshot "${name}" saved`);
    })
  );

  // Restore snapshot
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.restoreSnapshot', async () => {
      const snapshots = snapshotService.list();
      
      if (snapshots.length === 0) {
        vscode.window.showInformationMessage('No snapshots available');
        return;
      }

      const selected = await vscode.window.showQuickPick(
        snapshots.map(s => ({
          label: s.name,
          description: `${s.branch} - ${new Date(s.createdAt).toLocaleDateString()}`,
          snapshot: s,
        })),
        { placeHolder: 'Select snapshot to restore' }
      );

      if (!selected) return;

      await snapshotService.restore(selected.snapshot.id);
      vscode.window.showInformationMessage(`Snapshot "${selected.snapshot.name}" restored`);
    })
  );

  // Copy env files
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.copyEnv', async (wt?: WorktreeInfo) => {
      if (!wt) return;
      vscode.window.showInformationMessage(
        `Environment files would be copied to ${wt.path} (configurable patterns)`
      );
    })
  );

  // Compare with main
  context.subscriptions.push(
    vscode.commands.registerCommand('goly.compare', async (wt?: WorktreeInfo) => {
      if (!wt) return;
      const main = worktreeService.getAll().find(w => w.isMain);
      if (!main) {
        vscode.window.showInformationMessage('No main worktree found');
        return;
      }
      
      // Use VS Code's built-in diff command
      await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(main.path),
        vscode.Uri.file(wt.path),
        `${main.branch} ↔ ${wt.branch}`
      );
    })
  );
}

async function createWorktree(): Promise<void> {
  const config = getConfig();

  // Step 1: Choose branch source
  const branchSource = await vscode.window.showQuickPick([
    { label: '$(git-branch) Existing branch', value: 'existing' },
    { label: '$(add) New branch', value: 'new' },
  ], { placeHolder: 'Select branch source' });

  if (!branchSource) return;

  // Step 2: Get branch name
  let branchName: string;

  if (branchSource.value === 'existing') {
    const git = new GitClient(vscode.workspace.workspaceFolders![0].uri.fsPath);
    const branchesResult = await git.listBranches();
    
    if (!branchesResult.ok) {
      vscode.window.showErrorMessage('Failed to list branches');
      return;
    }

    const selected = await vscode.window.showQuickPick(
      branchesResult.value
        .filter(b => !b.isRemote)
        .map(b => ({ label: b.name, picked: b.isCurrent })),
      { placeHolder: 'Select branch' }
    );

    if (!selected) return;
    branchName = selected.label;
  } else {
    branchName = await vscode.window.showInputBox({
      prompt: 'Enter new branch name',
      validateInput: (value) => {
        if (!value || /^[a-zA-Z0-9_/-]+$/.test(value)) return null;
        return 'Invalid branch name';
      },
    }) ?? '';

    if (!branchName) return;
  }

  // Step 3: Get path
  const baseDir = expandTilde(config.baseDirectory);
  const worktreePath = await vscode.window.showInputBox({
    prompt: 'Enter worktree directory',
    value: `${baseDir}/${branchName.replace(/\//g, '-')}`,
    validateInput: (value) => {
      if (value) return null;
      return 'Path cannot be empty';
    },
  });

  if (!worktreePath) return;

  // Step 4: Options
  const createBranch = branchSource.value === 'new';

  // Create
  const result = await worktreeService.create(branchName, worktreePath, createBranch);
  
  if (!result.ok) {
    vscode.window.showErrorMessage(`Failed to create worktree: ${result.error.message}`);
  } else {
    vscode.window.showInformationMessage(
      `Worktree created: ${result.value.worktree.name}`
    );
  }
}

function createStatusBar(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = '$(layers) Goly';
  statusBarItem.command = 'goly.refresh';
  statusBarItem.tooltip = 'Click to refresh worktrees';
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);

  // Update on worktree changes
  worktreeService.on('worktree:created', updateStatusBar);
  worktreeService.on('worktree:removed', updateStatusBar);
}

function updateStatusBar(): void {
  const worktrees = worktreeService.getAll();
  const count = worktrees.length;
  const conflicts = worktrees.some(w => w.ports.length > 1);

  statusBarItem.text = conflicts
    ? `$(warning) Goly: ${count} (port conflict)`
    : `$(layers) Goly: ${count}`;
  statusBarItem.tooltip = `${count} worktree(s)`;
}

function setupWelcomeView(): void {
  vscode.commands.executeCommand('setContext', 'goly.hasWorktrees', false);
  
  worktreeService.on('worktree:created', () => {
    vscode.commands.executeCommand('setContext', 'goly.hasWorktrees', true);
  });
}
