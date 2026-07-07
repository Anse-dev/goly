import * as vscode from 'vscode';
import type { FileFinder } from '../ports/file-finder.js';

export class VscodeFileFinder implements FileFinder {
  async findFiles(
    baseDir: string,
    pattern: string,
    exclude: string,
    limit: number,
  ): Promise<Array<{ fsPath: string }>> {
    return vscode.workspace.findFiles(
      new vscode.RelativePattern(baseDir, pattern),
      exclude,
      limit,
    );
  }
}
