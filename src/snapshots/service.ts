/**
 * Workspace-context snapshots.
 */

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { isPathInside, toError } from '../core/types.js';
import { logger } from '../core/logger.js';

export interface Snapshot {
  id: string;
  name: string;
  worktreePath: string;
  branch: string;
  createdAt: number;
  restoredAt?: number;
  openFiles: string[];
  activeFile?: string;
  editorColumns: EditorColumn[];
  terminals: TerminalSnapshot[];
  breakpoints: BreakpointSnapshot[];
}

export interface EditorColumn {
  file: string;
  column: number;
}

export interface TerminalSnapshot {
  name: string;
  cwd: string;
  command?: string;
}

export interface BreakpointSnapshot {
  uri: string;
  line: number;
  enabled: boolean;
  condition?: string;
}

const STORAGE_KEY = 'goly.snapshots.v2';

export class SnapshotService {
  private snapshots: Snapshot[] = [];

  constructor(private readonly globalState: vscode.Memento) {
    this.load();
  }

  async save(
    name: string,
    worktreePath: string,
    branch: string,
  ): Promise<Snapshot> {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error('A snapshot name is required');
    }

    logger.info(`Saving snapshot ${normalizedName}`);
    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const snapshot: Snapshot = {
      id: `snap-${randomUUID()}`,
      name: normalizedName,
      worktreePath,
      branch,
      createdAt: Date.now(),
      openFiles: this.captureOpenFiles(worktreePath),
      activeFile:
        activePath && isPathInside(worktreePath, activePath)
          ? activePath
          : undefined,
      editorColumns: this.captureEditorColumns(worktreePath),
      terminals: this.captureTerminals(worktreePath),
      breakpoints: this.captureBreakpoints(worktreePath),
    };

    this.snapshots.push(snapshot);
    await this.persist();
    return cloneSnapshot(snapshot);
  }

  async restore(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.find(
      (candidate) => candidate.id === snapshotId,
    );
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    logger.info(`Restoring snapshot ${snapshot.name}`);
    const columns = new Map(
      snapshot.editorColumns.map((editor) => [editor.file, editor.column]),
    );

    for (const file of snapshot.openFiles) {
      if (
        !isPathInside(snapshot.worktreePath, file) ||
        file === snapshot.activeFile
      ) {
        continue;
      }
      await this.openFile(file, columns.get(file), true);
    }

    if (
      snapshot.activeFile &&
      isPathInside(snapshot.worktreePath, snapshot.activeFile)
    ) {
      await this.openFile(
        snapshot.activeFile,
        columns.get(snapshot.activeFile),
        false,
      );
    }

    await this.restoreBreakpoints(snapshot.worktreePath, snapshot.breakpoints);
    this.restoreTerminals(snapshot.worktreePath, snapshot.terminals);

    snapshot.restoredAt = Date.now();
    await this.persist();
  }

  async delete(snapshotId: string): Promise<boolean> {
    const previousLength = this.snapshots.length;
    this.snapshots = this.snapshots.filter(
      (snapshot) => snapshot.id !== snapshotId,
    );
    if (this.snapshots.length === previousLength) {
      return false;
    }
    await this.persist();
    return true;
  }

  list(worktreePath?: string): Snapshot[] {
    return this.snapshots
      .filter(
        (snapshot) => !worktreePath || snapshot.worktreePath === worktreePath,
      )
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(cloneSnapshot);
  }

  get(snapshotId: string): Snapshot | undefined {
    const snapshot = this.snapshots.find(
      (candidate) => candidate.id === snapshotId,
    );
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  export(snapshotId: string): string {
    const snapshot = this.get(snapshotId);
    if (!snapshot) {
      throw new Error('Snapshot not found');
    }
    return JSON.stringify(snapshot, null, 2);
  }

  async import(json: string): Promise<Snapshot> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error(`Invalid snapshot JSON: ${toError(error).message}`);
    }
    if (!isSnapshot(parsed)) {
      throw new Error(
        'The imported snapshot does not match the expected schema',
      );
    }

    const imported: Snapshot = {
      ...parsed,
      id: `snap-${randomUUID()}`,
      createdAt: Date.now(),
      restoredAt: undefined,
      openFiles: parsed.openFiles.filter((file) =>
        isPathInside(parsed.worktreePath, file),
      ),
      editorColumns: parsed.editorColumns.filter((editor) =>
        isPathInside(parsed.worktreePath, editor.file),
      ),
      terminals: parsed.terminals.filter((terminal) =>
        isPathInside(parsed.worktreePath, terminal.cwd),
      ),
      breakpoints: parsed.breakpoints.filter((breakpoint) => {
        const uri = vscode.Uri.parse(breakpoint.uri);
        return (
          uri.scheme === 'file' && isPathInside(parsed.worktreePath, uri.fsPath)
        );
      }),
    };
    this.snapshots.push(imported);
    await this.persist();
    return cloneSnapshot(imported);
  }

  private captureOpenFiles(worktreePath: string): string[] {
    const files = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputText &&
          isPathInside(worktreePath, tab.input.uri.fsPath)
        ) {
          files.add(tab.input.uri.fsPath);
        }
      }
    }
    return [...files];
  }

  private captureEditorColumns(worktreePath: string): EditorColumn[] {
    return vscode.window.visibleTextEditors.flatMap((editor) => {
      if (!isPathInside(worktreePath, editor.document.uri.fsPath)) {
        return [];
      }
      return [
        {
          file: editor.document.uri.fsPath,
          column: editor.viewColumn ?? vscode.ViewColumn.One,
        },
      ];
    });
  }

  private captureTerminals(worktreePath: string): TerminalSnapshot[] {
    return vscode.window.terminals.flatMap((terminal) => {
      const options = terminal.creationOptions;
      if (!('cwd' in options) || !options.cwd) {
        return [];
      }
      const cwd =
        typeof options.cwd === 'string' ? options.cwd : options.cwd.fsPath;
      if (!isPathInside(worktreePath, cwd)) {
        return [];
      }
      return [{ name: terminal.name, cwd }];
    });
  }

  private captureBreakpoints(worktreePath: string): BreakpointSnapshot[] {
    return vscode.debug.breakpoints.flatMap((breakpoint) => {
      if (
        !(breakpoint instanceof vscode.SourceBreakpoint) ||
        breakpoint.location.uri.scheme !== 'file' ||
        !isPathInside(worktreePath, breakpoint.location.uri.fsPath)
      ) {
        return [];
      }
      return [
        {
          uri: breakpoint.location.uri.toString(),
          line: breakpoint.location.range.start.line,
          enabled: breakpoint.enabled,
          condition: breakpoint.condition,
        },
      ];
    });
  }

  private async openFile(
    file: string,
    column: number | undefined,
    preserveFocus: boolean,
  ): Promise<void> {
    try {
      await fs.access(file);
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(file),
      );
      await vscode.window.showTextDocument(document, {
        viewColumn: normalizeViewColumn(column),
        preserveFocus,
        preview: false,
      });
    } catch (error) {
      logger.warn(`Could not restore file ${file}`, error);
    }
  }

  private async restoreBreakpoints(
    worktreePath: string,
    breakpoints: readonly BreakpointSnapshot[],
  ): Promise<void> {
    const existing = vscode.debug.breakpoints.filter(
      (breakpoint) =>
        breakpoint instanceof vscode.SourceBreakpoint &&
        breakpoint.location.uri.scheme === 'file' &&
        isPathInside(worktreePath, breakpoint.location.uri.fsPath),
    );
    vscode.debug.removeBreakpoints(existing);

    const restored = breakpoints.flatMap((breakpoint) => {
      try {
        const uri = vscode.Uri.parse(breakpoint.uri);
        if (uri.scheme !== 'file' || !isPathInside(worktreePath, uri.fsPath)) {
          return [];
        }
        const location = new vscode.Location(
          uri,
          new vscode.Position(breakpoint.line, 0),
        );
        return [
          new vscode.SourceBreakpoint(
            location,
            breakpoint.enabled,
            breakpoint.condition,
          ),
        ];
      } catch (error) {
        logger.warn(`Could not restore breakpoint ${breakpoint.uri}`, error);
        return [];
      }
    });
    if (restored.length > 0) {
      vscode.debug.addBreakpoints(restored);
    }
  }

  private restoreTerminals(
    worktreePath: string,
    terminals: readonly TerminalSnapshot[],
  ): void {
    for (const terminal of terminals) {
      if (!isPathInside(worktreePath, terminal.cwd)) {
        continue;
      }
      vscode.window.createTerminal({
        name: terminal.name,
        cwd: terminal.cwd,
      });
    }
  }

  private load(): void {
    const stored =
      this.globalState.get<unknown>(STORAGE_KEY) ??
      this.globalState.get<unknown>('goly.snapshots.v1');
    if (Array.isArray(stored)) {
      this.snapshots = stored.filter(isSnapshot).map(cloneSnapshot);
    }
  }

  private async persist(): Promise<void> {
    await this.globalState.update(STORAGE_KEY, this.snapshots);
  }
}

function normalizeViewColumn(column: number | undefined): vscode.ViewColumn {
  if (
    column === vscode.ViewColumn.One ||
    column === vscode.ViewColumn.Two ||
    column === vscode.ViewColumn.Three ||
    column === vscode.ViewColumn.Four ||
    column === vscode.ViewColumn.Five ||
    column === vscode.ViewColumn.Six ||
    column === vscode.ViewColumn.Seven ||
    column === vscode.ViewColumn.Eight ||
    column === vscode.ViewColumn.Nine
  ) {
    return column;
  }
  return vscode.ViewColumn.One;
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    openFiles: [...snapshot.openFiles],
    editorColumns: snapshot.editorColumns.map((editor) => ({ ...editor })),
    terminals: snapshot.terminals.map((terminal) => ({ ...terminal })),
    breakpoints: snapshot.breakpoints.map((breakpoint) => ({ ...breakpoint })),
  };
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const snapshot = value as Partial<Snapshot>;
  return (
    typeof snapshot.id === 'string' &&
    typeof snapshot.name === 'string' &&
    typeof snapshot.worktreePath === 'string' &&
    typeof snapshot.branch === 'string' &&
    typeof snapshot.createdAt === 'number' &&
    Array.isArray(snapshot.openFiles) &&
    snapshot.openFiles.every((file) => typeof file === 'string') &&
    Array.isArray(snapshot.editorColumns) &&
    snapshot.editorColumns.every(isEditorColumn) &&
    Array.isArray(snapshot.terminals) &&
    snapshot.terminals.every(isTerminalSnapshot) &&
    Array.isArray(snapshot.breakpoints) &&
    snapshot.breakpoints.every(isBreakpointSnapshot)
  );
}

function isEditorColumn(value: unknown): value is EditorColumn {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const column = value as Partial<EditorColumn>;
  return typeof column.file === 'string' && Number.isInteger(column.column);
}

function isTerminalSnapshot(value: unknown): value is TerminalSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const terminal = value as Partial<TerminalSnapshot>;
  return (
    typeof terminal.name === 'string' &&
    typeof terminal.cwd === 'string' &&
    (terminal.command === undefined || typeof terminal.command === 'string')
  );
}

function isBreakpointSnapshot(value: unknown): value is BreakpointSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const breakpoint = value as Partial<BreakpointSnapshot>;
  return (
    typeof breakpoint.uri === 'string' &&
    Number.isInteger(breakpoint.line) &&
    typeof breakpoint.enabled === 'boolean' &&
    (breakpoint.condition === undefined ||
      typeof breakpoint.condition === 'string')
  );
}
