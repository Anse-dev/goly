import * as vscode from 'vscode';
import type { WorkspaceTrust } from '../ports/workspace-trust.js';

export class VscodeWorkspaceTrust implements WorkspaceTrust {
  get isTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }
}
