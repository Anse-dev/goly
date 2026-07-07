import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetMock,
  __setMockConfig,
  __setWarningMessageResult,
} from './vscode.mock.js';
import { WorktreeService } from '../worktrees/service.js';
import { VscodeEditorNavigator } from '../adapters/vscode-editor-navigator.js';
import { VscodeFileFinder } from '../adapters/vscode-file-finder.js';
import { VscodeWorkspaceWatcher } from '../adapters/vscode-workspace-watcher.js';
import { VscodeWorkspaceTrust } from '../adapters/vscode-workspace-trust.js';
import { VscodeCommandConfirmation } from '../adapters/vscode-command-confirmation.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

beforeEach(() => {
  __resetMock();
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('WorktreeService', () => {
  it('creates and removes a real worktree', async () => {
    const repository = await createRepository();
    const service = new WorktreeService(repository, {
      watcher: new VscodeWorkspaceWatcher(),
      fileFinder: new VscodeFileFinder(),
      navigator: new VscodeEditorNavigator(),
      workspaceTrust: new VscodeWorkspaceTrust(),
      commandConfirmation: new VscodeCommandConfirmation(),
    });
    const initialized = await service.init();
    expect(initialized.ok).toBe(true);

    const worktreePath = path.join(
      path.dirname(repository),
      'feature-worktree',
    );
    temporaryDirectories.push(worktreePath);
    const created = await service.create('feature/service-test', worktreePath, {
      createBranch: true,
      copyEnvironment: false,
      runPostCreateCommands: false,
      openInNewWindow: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      service.dispose();
      return;
    }

    expect(service.getAll()).toHaveLength(2);
    expect(created.value.worktree.branch).toBe('feature/service-test');

    const removed = await service.remove(worktreePath, true, true);
    expect(removed.ok).toBe(true);
    expect(service.getAll()).toHaveLength(1);
    service.dispose();
  });

  it('warns instead of running post-create commands without confirmation', async () => {
    __setMockConfig({
      postCreateCommands: ['node -e "process.exit(0)"'],
      confirmBeforePostCreateCommands: true,
    });
    __setWarningMessageResult(undefined);

    const repository = await createRepository();
    const service = new WorktreeService(repository, {
      watcher: new VscodeWorkspaceWatcher(),
      fileFinder: new VscodeFileFinder(),
      navigator: new VscodeEditorNavigator(),
      workspaceTrust: new VscodeWorkspaceTrust(),
      commandConfirmation: new VscodeCommandConfirmation(),
    });
    const initialized = await service.init();
    expect(initialized.ok).toBe(true);

    const worktreePath = path.join(path.dirname(repository), 'skipped-command');
    temporaryDirectories.push(worktreePath);
    const created = await service.create('feature/skip-command', worktreePath, {
      createBranch: true,
      copyEnvironment: false,
      openInNewWindow: false,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      service.dispose();
      return;
    }
    expect(created.value.warnings).toContain(
      'Post-create commands skipped by user',
    );

    const removed = await service.remove(worktreePath, true, true);
    expect(removed.ok).toBe(true);
    service.dispose();
  });
});

async function createRepository(): Promise<string> {
  const repository = await fs.mkdtemp(path.join(tmpdir(), 'goly-worktree-'));
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
