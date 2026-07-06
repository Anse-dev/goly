/**
 * Snapshot Service
 * 
 * Saves and restores workspace context including:
 * - Open files and editor layout
 * - Terminal sessions (cwd + command to re-run)
 * - Breakpoints
 * 
 * Note: Terminal state cannot be fully restored - we capture cwd and command
 * to re-propose to the user.
 */

import * as vscode from 'vscode';
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
  layout?: string; // future: full layout state
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

const SCHEMA_VERSION = 1;

export class SnapshotService {
  private snapshots: Snapshot[] = [];
  private storageKey = `goly.snapshots.v${SCHEMA_VERSION}`;

  constructor(private globalState: vscode.Memento) {
    this.load();
  }

  /**
   * Save current workspace context as a snapshot
   */
  async save(name: string, worktreePath: string, branch: string): Promise<Snapshot> {
    logger.info(`Saving snapshot: ${name}`);

    const openFiles = this.captureOpenFiles();
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    const editorColumns = this.captureEditorColumns();
    const terminals = this.captureTerminals();
    const breakpoints = this.captureBreakpoints();

    const snapshot: Snapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      worktreePath,
      branch,
      createdAt: Date.now(),
      openFiles,
      activeFile,
      editorColumns,
      terminals,
      breakpoints,
    };

    this.snapshots.push(snapshot);
    this.persist();

    return snapshot;
  }

  /**
   * Restore a snapshot
   */
  async restore(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.find(s => s.id === snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    logger.info(`Restoring snapshot: ${snapshot.name}`);

    // Close all editors
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    // Restore open files
    for (const file of snapshot.openFiles) {
      try {
        const uri = vscode.Uri.file(file);
        await vscode.commands.executeCommand('vscode.open', uri);
      } catch (e) {
        logger.warn(`Failed to open file: ${file}`, e);
      }
    }

    // Restore active file
    if (snapshot.activeFile) {
      try {
        const uri = vscode.Uri.file(snapshot.activeFile);
        await vscode.commands.executeCommand('vscode.open', uri);
      } catch {
        // Ignore
      }
    }

    // Restore breakpoints
    await this.restoreBreakpoints(snapshot.breakpoints);

    // Note: Terminals cannot be restored - we just log them
    if (snapshot.terminals.length > 0) {
      vscode.window.showInformationMessage(
        `Snapshot restored. ${snapshot.terminals.length} terminal(s) captured - please restart them manually.`
      );
    }

    snapshot.restoredAt = Date.now();
    this.persist();
  }

  /**
   * Delete a snapshot
   */
  delete(snapshotId: string): void {
    this.snapshots = this.snapshots.filter(s => s.id !== snapshotId);
    this.persist();
  }

  /**
   * List all snapshots
   */
  list(): Snapshot[] {
    return [...this.snapshots].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get snapshot by ID
   */
  get(snapshotId: string): Snapshot | undefined {
    return this.snapshots.find(s => s.id === snapshotId);
  }

  /**
   * Export snapshot as JSON
   */
  export(snapshotId: string): string {
    const snapshot = this.get(snapshotId);
    if (!snapshot) throw new Error('Snapshot not found');
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Import snapshot from JSON
   */
  async import(json: string): Promise<Snapshot> {
    const imported = JSON.parse(json) as Snapshot;
    imported.id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    imported.createdAt = Date.now();
    imported.restoredAt = undefined;
    this.snapshots.push(imported);
    this.persist();
    return imported;
  }

  // Private capture methods

  private captureOpenFiles(): string[] {
    const files: string[] = [];
    
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          files.push(tab.input.uri.fsPath);
        }
      }
    }
    
    return files;
  }

  private captureEditorColumns(): EditorColumn[] {
    const columns: EditorColumn[] = [];
    
    for (const editor of vscode.window.visibleTextEditors) {
      columns.push({
        file: editor.document.uri.fsPath,
        column: vscode.window.activeTextEditor === editor ? 0 : 1,
      });
    }
    
    return columns;
  }

  private captureTerminals(): TerminalSnapshot[] {
    // Terminal state cannot be captured - we return empty
    // In the future, we could capture cwd if VS Code exposes it
    return [];
  }

  private captureBreakpoints(): BreakpointSnapshot[] {
    const breakpoints: BreakpointSnapshot[] = [];
    
    const allBreakpoints = vscode.debug.breakpoints || [];
    for (const bp of allBreakpoints) {
      if (bp instanceof vscode.SourceBreakpoint) {
        breakpoints.push({
          uri: bp.location.uri.toString(),
          line: bp.location.range.start.line,
          enabled: bp.enabled,
          condition: bp.condition,
        });
      }
    }
    
    return breakpoints;
  }

  private async restoreBreakpoints(breakpoints: BreakpointSnapshot[]): Promise<void> {
    // Clear existing breakpoints first
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints || []);
    
    for (const bp of breakpoints) {
      try {
        const uri = vscode.Uri.parse(bp.uri);
        const location = new vscode.Location(uri, new vscode.Range(bp.line, 0, bp.line, 0));
        const breakpoint = new vscode.SourceBreakpoint(location, bp.enabled, bp.condition);
        vscode.debug.addBreakpoints([breakpoint]);
      } catch (e) {
        logger.warn(`Failed to restore breakpoint: ${bp.uri}:${bp.line}`, e);
      }
    }
  }

  private load(): void {
    const stored = this.globalState.get<Snapshot[]>(this.storageKey);
    if (stored) {
      this.snapshots = stored;
    }
  }

  private persist(): void {
    this.globalState.update(this.storageKey, this.snapshots);
  }
}
