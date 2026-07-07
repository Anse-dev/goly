/**
 * Goly extension entry point.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { expandTilde, toError } from './core/types.js';
import { GitClient } from './git/client.js';
import { ReviewService } from './review/service.js';
import { SnapshotService } from './snapshots/service.js';
import { GolyTreeProvider } from './ui/sidebar/provider.js';
import { WorktreeService } from './worktrees/service.js';
import type { WorktreeInfo } from './worktrees/service.js';
import { VscodeSessionStore } from './adapters/vscode-session-store.js';
import { VscodeEditorNavigator } from './adapters/vscode-editor-navigator.js';
import { VscodeFileFinder } from './adapters/vscode-file-finder.js';
import { VscodeWorkspaceWatcher } from './adapters/vscode-workspace-watcher.js';
import { VscodeWorkspaceTrust } from './adapters/vscode-workspace-trust.js';
import { VscodeCommandConfirmation } from './adapters/vscode-command-confirmation.js';

let worktreeService: WorktreeService | undefined;
let reviewService: ReviewService | undefined;
let snapshotService: SnapshotService | undefined;
let treeProvider: GolyTreeProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

const COMMANDS = [
  'goly.refresh',
  'goly.create',
  'goly.remove',
  'goly.open',
  'goly.terminal',
  'goly.snapshot',
  'goly.restoreSnapshot',
  'goly.review',
  'goly.endReview',
  'goly.copyEnv',
  'goly.compare',
] as const;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const startTime = Date.now();
  logger.info('Goly activating');
  context.subscriptions.push({ dispose: () => logger.dispose() });

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    registerUnavailableCommands(
      context,
      'Open a folder containing a Git repository first.',
    );
    logger.warn('No workspace folder is open');
    return;
  }

  const repositoryPath = workspaceFolder.uri.fsPath;
  const git = new GitClient(repositoryPath);
  if (!(await git.isRepository())) {
    registerUnavailableCommands(
      context,
      'The current folder is not a Git repository.',
    );
    logger.warn('The workspace is not a Git repository');
    return;
  }

  worktreeService = new WorktreeService(repositoryPath, {
    watcher: new VscodeWorkspaceWatcher(),
    fileFinder: new VscodeFileFinder(),
    navigator: new VscodeEditorNavigator(),
    workspaceTrust: new VscodeWorkspaceTrust(),
    commandConfirmation: new VscodeCommandConfirmation(),
  });
  const initialResult = await worktreeService.init();
  if (!initialResult.ok) {
    worktreeService.dispose();
    worktreeService = undefined;
    registerUnavailableCommands(context, initialResult.error.message);
    logger.error('Could not initialize worktrees', initialResult.error);
    return;
  }

  reviewService = new ReviewService(
    git,
    worktreeService,
    new VscodeSessionStore(context.globalState),
    new VscodeEditorNavigator(),
  );
  snapshotService = new SnapshotService(
    new VscodeSessionStore(context.globalState),
  );
  treeProvider = new GolyTreeProvider(worktreeService);

  context.subscriptions.push(
    worktreeService,
    treeProvider,
    vscode.window.registerTreeDataProvider('goly.sidebar', treeProvider),
  );

  registerCommands(context, git);
  createStatusBar(context);
  setupViewContext(context);

  logger.info(`Goly activated in ${Date.now() - startTime}ms`);
}

export function deactivate(): void {
  logger.info('Goly deactivated');
}

function registerCommands(
  context: vscode.ExtensionContext,
  git: GitClient,
): void {
  const service = requireWorktreeService();
  const reviews = requireReviewService();
  const snapshots = requireSnapshotService();
  const provider = requireTreeProvider();

  context.subscriptions.push(
    vscode.commands.registerCommand('goly.refresh', async () => {
      try {
        await provider.refresh();
      } catch (error) {
        await vscode.window.showErrorMessage(
          `Refresh failed: ${toError(error).message}`,
        );
      }
    }),

    vscode.commands.registerCommand('goly.create', async () => {
      await createWorktree(git, service);
    }),

    vscode.commands.registerCommand(
      'goly.remove',
      async (worktree?: WorktreeInfo) => {
        const selected =
          worktree ??
          (await pickWorktree(
            service,
            'Select a worktree to remove',
            (candidate) => !candidate.isMain,
          ));
        if (!selected) {
          return;
        }

        const config = getConfig();
        let deleteBranch = false;
        if (config.confirmBeforeDelete) {
          const choices = ['Delete Worktree Only'];
          if (config.confirmBeforeDeleteBranch) {
            choices.push('Delete Worktree + Branch');
          }
          const choice = await vscode.window.showWarningMessage(
            `Delete worktree "${selected.name}"?`,
            { modal: true },
            ...choices,
          );
          if (!choice) {
            return;
          }
          deleteBranch = choice === 'Delete Worktree + Branch';
        }

        const result = await service.remove(selected.path, deleteBranch);
        if (!result.ok) {
          await vscode.window.showErrorMessage(
            `Removal failed: ${result.error.message}`,
          );
          return;
        }
        await vscode.window.showInformationMessage(
          `Worktree "${selected.name}" removed`,
        );
      },
    ),

    vscode.commands.registerCommand(
      'goly.open',
      async (worktree?: WorktreeInfo) => {
        const selected =
          worktree ??
          (await pickWorktree(service, 'Select a worktree to open'));
        if (!selected) {
          return;
        }
        await vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(selected.path),
          { forceNewWindow: true },
        );
      },
    ),

    vscode.commands.registerCommand(
      'goly.terminal',
      async (worktree?: WorktreeInfo) => {
        const selected =
          worktree ??
          (await pickWorktree(service, 'Select a worktree for the terminal'));
        if (!selected) {
          return;
        }
        vscode.window
          .createTerminal({
            name: `Goly: ${selected.name}`,
            cwd: selected.path,
          })
          .show();
      },
    ),

    vscode.commands.registerCommand('goly.review', async () => {
      const ref = await vscode.window.showInputBox({
        prompt: 'Enter a branch or pull-request ref to review',
        placeHolder: 'origin/feature-name or refs/pull/123/head',
        validateInput: (value) =>
          value.trim() ? undefined : 'A ref is required',
      });
      if (!ref) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Preparing review for ${ref}`,
        },
        async () => {
          const result = await reviews.startReview(ref);
          if (!result.ok) {
            await vscode.window.showErrorMessage(
              `Review failed: ${result.error.message}`,
            );
            return;
          }
          await vscode.window.showInformationMessage(
            `Review worktree created for ${result.value.ref}`,
          );
        },
      );
    }),

    vscode.commands.registerCommand('goly.endReview', async () => {
      const sessions = reviews.listSessions();
      if (sessions.length === 0) {
        await vscode.window.showInformationMessage('No active review sessions');
        return;
      }
      const selected = await vscode.window.showQuickPick(
        sessions.map((session) => ({
          label: session.ref,
          description: session.branch,
          detail: session.worktreePath,
          session,
        })),
        { placeHolder: 'Select a review session to remove' },
      );
      if (!selected) {
        return;
      }
      const result = await reviews.endReview(selected.session.id);
      if (!result.ok) {
        await vscode.window.showErrorMessage(
          `Cleanup failed: ${result.error.message}`,
        );
        return;
      }
      await vscode.window.showInformationMessage(
        `Review "${selected.session.ref}" removed`,
      );
    }),

    vscode.commands.registerCommand(
      'goly.snapshot',
      async (worktree?: WorktreeInfo) => {
        const selected =
          worktree ??
          (await pickWorktree(service, 'Select the worktree to snapshot'));
        if (!selected) {
          return;
        }
        const name = await vscode.window.showInputBox({
          prompt: 'Enter a snapshot name',
          validateInput: (value) =>
            value.trim() ? undefined : 'A name is required',
        });
        if (!name) {
          return;
        }

        try {
          await snapshots.save(name, selected.path, selected.branch);
          await vscode.window.showInformationMessage(
            `Snapshot "${name.trim()}" saved`,
          );
        } catch (error) {
          await vscode.window.showErrorMessage(
            `Snapshot failed: ${toError(error).message}`,
          );
        }
      },
    ),

    vscode.commands.registerCommand('goly.restoreSnapshot', async () => {
      const available = snapshots.list();
      if (available.length === 0) {
        await vscode.window.showInformationMessage('No snapshots available');
        return;
      }
      const selected = await vscode.window.showQuickPick(
        available.map((snapshot) => ({
          label: snapshot.name,
          description: snapshot.branch,
          detail: new Date(snapshot.createdAt).toLocaleString(),
          snapshot,
        })),
        { placeHolder: 'Select a snapshot to restore' },
      );
      if (!selected) {
        return;
      }
      try {
        await snapshots.restore(selected.snapshot.id);
        await vscode.window.showInformationMessage(
          `Snapshot "${selected.snapshot.name}" restored`,
        );
      } catch (error) {
        await vscode.window.showErrorMessage(
          `Restore failed: ${toError(error).message}`,
        );
      }
    }),

    vscode.commands.registerCommand(
      'goly.copyEnv',
      async (worktree?: WorktreeInfo) => {
        const selected =
          worktree ??
          (await pickWorktree(
            service,
            'Select the destination worktree',
            (candidate) => !candidate.isMain,
          ));
        if (!selected) {
          return;
        }
        const result = await service.copyEnvironmentFiles(selected.path);
        if (!result.ok) {
          await vscode.window.showErrorMessage(result.error.message);
          return;
        }
        await vscode.window.showInformationMessage(
          `${result.value} environment file(s) copied to ${selected.name}`,
        );
      },
    ),

    vscode.commands.registerCommand(
      'goly.compare',
      async (worktree?: WorktreeInfo) => {
        const selected =
          worktree ??
          (await pickWorktree(
            service,
            'Select a worktree to compare',
            (candidate) => !candidate.isMain,
          ));
        if (!selected) {
          return;
        }
        const main = service.getAll().find((candidate) => candidate.isMain);
        if (!main) {
          await vscode.window.showErrorMessage(
            'The main worktree could not be found',
          );
          return;
        }

        const result = await new GitClient(selected.path).diff(
          main.branch,
          selected.branch,
        );
        if (!result.ok) {
          await vscode.window.showErrorMessage(
            `Comparison failed: ${result.error.message}`,
          );
          return;
        }
        const document = await vscode.workspace.openTextDocument({
          language: 'diff',
          content:
            result.value ||
            `No differences between ${main.branch} and ${selected.branch}\n`,
        });
        await vscode.window.showTextDocument(document, { preview: false });
      },
    ),
  );
}

async function createWorktree(
  git: GitClient,
  service: WorktreeService,
): Promise<void> {
  const branchSource = await vscode.window.showQuickPick(
    [
      { label: '$(git-branch) Existing branch', value: 'existing' as const },
      { label: '$(add) New branch', value: 'new' as const },
    ],
    { placeHolder: 'Select a branch source' },
  );
  if (!branchSource) {
    return;
  }

  let branchName: string;
  if (branchSource.value === 'existing') {
    const branchesResult = await git.listBranches();
    if (!branchesResult.ok) {
      await vscode.window.showErrorMessage(
        `Could not list branches: ${branchesResult.error.message}`,
      );
      return;
    }

    const usedBranches = new Set(
      service.getAll().map((worktree) => worktree.branch),
    );
    const choices = branchesResult.value
      .filter((branch) => !branch.isRemote && !usedBranches.has(branch.name))
      .map((branch) => ({
        label: branch.name,
        description: branch.upstream,
      }));
    if (choices.length === 0) {
      await vscode.window.showInformationMessage(
        'Every local branch already has a worktree',
      );
      return;
    }
    const selected = await vscode.window.showQuickPick(choices, {
      placeHolder: 'Select a branch',
    });
    if (!selected) {
      return;
    }
    branchName = selected.label;
  } else {
    const enteredBranch = await vscode.window.showInputBox({
      prompt: 'Enter the new branch name',
      validateInput: async (value) => {
        return (await git.validateBranchName(value))
          ? undefined
          : 'Enter a valid Git branch name';
      },
    });
    if (!enteredBranch) {
      return;
    }
    branchName = enteredBranch;
  }

  const baseDirectory = expandTilde(getConfig().baseDirectory);
  const requestedPath = await vscode.window.showInputBox({
    prompt: 'Enter the worktree directory',
    value: path.join(baseDirectory, branchName.replace(/\//g, '-')),
    validateInput: (value) => (value.trim() ? undefined : 'A path is required'),
  });
  if (!requestedPath) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Creating ${branchName}`,
    },
    async () => {
      const result = await service.create(branchName, requestedPath, {
        createBranch: branchSource.value === 'new',
      });
      if (!result.ok) {
        await vscode.window.showErrorMessage(
          `Creation failed: ${result.error.message}`,
        );
        return;
      }
      const warningSuffix =
        result.value.warnings.length > 0
          ? ` (${result.value.warnings.join('; ')})`
          : '';
      await vscode.window.showInformationMessage(
        `Worktree "${result.value.worktree.name}" created${warningSuffix}`,
      );
    },
  );
}

function createStatusBar(context: vscode.ExtensionContext): void {
  const service = requireWorktreeService();
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = 'goly.refresh';
  context.subscriptions.push(statusBarItem);

  const update = (): void => updateStatusBar(service);
  context.subscriptions.push(
    service.on('worktree:created', update),
    service.on('worktree:removed', update),
    service.on('worktree:updated', update),
  );
  update();
  statusBarItem.show();
}

function updateStatusBar(service: WorktreeService): void {
  if (!statusBarItem) {
    return;
  }
  const worktrees = service.getAll();
  const owners = new Map<number, string>();
  const conflicts = new Set<number>();
  for (const worktree of worktrees) {
    for (const port of worktree.ports) {
      const owner = owners.get(port);
      if (owner && owner !== worktree.path) {
        conflicts.add(port);
      } else {
        owners.set(port, worktree.path);
      }
    }
  }

  statusBarItem.text =
    conflicts.size > 0
      ? `$(warning) Goly: ${worktrees.length} (${[...conflicts].join(', ')})`
      : `$(layers) Goly: ${worktrees.length}`;
  statusBarItem.tooltip =
    conflicts.size > 0
      ? `Port conflict: ${[...conflicts].join(', ')}`
      : `${worktrees.length} worktree(s)`;
}

function setupViewContext(context: vscode.ExtensionContext): void {
  const service = requireWorktreeService();
  const update = (): void => {
    void vscode.commands.executeCommand(
      'setContext',
      'goly.hasWorktrees',
      service.getAll().length > 0,
    );
  };
  context.subscriptions.push(
    service.on('worktree:created', update),
    service.on('worktree:removed', update),
  );
  update();
}

async function pickWorktree(
  service: WorktreeService,
  placeHolder: string,
  predicate: (worktree: WorktreeInfo) => boolean = () => true,
): Promise<WorktreeInfo | undefined> {
  const selected = await vscode.window.showQuickPick(
    service
      .getAll()
      .filter(predicate)
      .map((worktree) => ({
        label: worktree.name,
        description: worktree.branch,
        detail: worktree.path,
        worktree,
      })),
    { placeHolder },
  );
  return selected?.worktree;
}

function registerUnavailableCommands(
  context: vscode.ExtensionContext,
  message: string,
): void {
  for (const command of COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        await vscode.window.showErrorMessage(message);
      }),
    );
  }
}

function requireWorktreeService(): WorktreeService {
  if (!worktreeService) {
    throw new Error('Worktree service is not initialized');
  }
  return worktreeService;
}

function requireReviewService(): ReviewService {
  if (!reviewService) {
    throw new Error('Review service is not initialized');
  }
  return reviewService;
}

function requireSnapshotService(): SnapshotService {
  if (!snapshotService) {
    throw new Error('Snapshot service is not initialized');
  }
  return snapshotService;
}

function requireTreeProvider(): GolyTreeProvider {
  if (!treeProvider) {
    throw new Error('Tree provider is not initialized');
  }
  return treeProvider;
}
