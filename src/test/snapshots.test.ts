import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetMock,
  debug,
  Location,
  Position,
  SourceBreakpoint,
  TabInputText,
  Uri,
  ViewColumn,
  window,
} from './vscode.mock.js';
import { SnapshotService } from '../snapshots/service.js';
import type { SessionStore } from '../ports/session-store.js';

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

describe('SnapshotService', () => {
  it('captures and restores only worktree-scoped context', async () => {
    const worktreePath = await fs.mkdtemp(path.join(tmpdir(), 'goly-snap-'));
    const externalPath = await fs.mkdtemp(
      path.join(tmpdir(), 'goly-external-'),
    );
    temporaryDirectories.push(worktreePath, externalPath);
    const insideFile = path.join(worktreePath, 'src', 'index.ts');
    const outsideFile = path.join(externalPath, 'outside.ts');
    await fs.mkdir(path.dirname(insideFile), { recursive: true });
    await fs.writeFile(insideFile, 'console.log("inside");\n');
    await fs.writeFile(outsideFile, 'console.log("outside");\n');

    window.tabGroups.all = [
      {
        tabs: [
          { input: new TabInputText(Uri.file(insideFile)) },
          { input: new TabInputText(Uri.file(outsideFile)) },
        ],
      },
    ];
    window.activeTextEditor = {
      document: { uri: Uri.file(insideFile) },
      viewColumn: ViewColumn.Two,
    };
    window.visibleTextEditors = [
      {
        document: { uri: Uri.file(insideFile) },
        viewColumn: ViewColumn.Two,
      },
      {
        document: { uri: Uri.file(outsideFile) },
        viewColumn: ViewColumn.One,
      },
    ];
    window.terminals = [
      {
        name: 'dev',
        creationOptions: { cwd: worktreePath },
        show: () => undefined,
      },
      {
        name: 'external',
        creationOptions: { cwd: externalPath },
        show: () => undefined,
      },
    ];
    debug.breakpoints = [
      new SourceBreakpoint(
        new Location(Uri.file(insideFile), new Position(3, 0)),
        true,
        'value > 1',
      ),
      new SourceBreakpoint(
        new Location(Uri.file(outsideFile), new Position(1, 0)),
      ),
    ];

    const service = new SnapshotService(new MemoryMemento());
    const snapshot = await service.save('daily context', worktreePath, 'main');

    expect(snapshot.openFiles).toEqual([insideFile]);
    expect(snapshot.activeFile).toBe(insideFile);
    expect(snapshot.editorColumns).toEqual([
      { file: insideFile, column: ViewColumn.Two },
    ]);
    expect(snapshot.terminals).toEqual([{ name: 'dev', cwd: worktreePath }]);
    expect(snapshot.breakpoints).toHaveLength(1);

    window.terminals = [];
    debug.breakpoints = [];
    await service.restore(snapshot.id);

    expect(window.terminals).toHaveLength(1);
    expect(window.terminals[0]?.name).toBe('dev');
    expect(debug.breakpoints).toHaveLength(1);
    expect(debug.breakpoints[0]?.condition).toBe('value > 1');
  });
});

class MemoryMemento implements SessionStore {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
      return;
    }
    this.values.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}
