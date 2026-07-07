import * as path from 'path';
import * as vscode from 'vscode';
import type { CommandConfirmation } from '../ports/command-confirmation.js';

export class VscodeCommandConfirmation implements CommandConfirmation {
  async askBeforeRunning(
    worktreeName: string,
    commands: readonly string[],
  ): Promise<boolean> {
    const runChoice = 'Run Commands';
    const choice = await vscode.window.showWarningMessage(
      `Run ${commands.length} post-create command(s) in "${path.basename(worktreeName)}"?`,
      { modal: true, detail: commands.map((c) => `• ${c}`).join('\n') },
      runChoice,
    );
    return choice === runChoice;
  }
}
