import * as vscode from 'vscode';
import type { WorkspaceWatcher } from '../ports/workspace-watcher.js';

export class VscodeWorkspaceWatcher implements WorkspaceWatcher {
  watch(
    baseDir: string,
    pattern: string,
    listener: () => void,
  ): { dispose(): void } {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(baseDir, pattern),
    );
    const disposables = [
      watcher.onDidChange(listener),
      watcher.onDidCreate(listener),
      watcher.onDidDelete(listener),
    ];
    return {
      dispose: () => {
        for (const d of disposables) {
          d.dispose();
        }
        watcher.dispose();
      },
    };
  }
}
