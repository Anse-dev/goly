import * as vscode from 'vscode';
import type { EditorNavigator } from '../ports/editor-navigator.js';

export class VscodeEditorNavigator implements EditorNavigator {
  async openFolderInNewWindow(folderPath: string): Promise<void> {
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(folderPath),
      { forceNewWindow: true },
    );
  }
}
