import type * as vscode from 'vscode';
import type { SessionStore } from '../ports/session-store.js';

export class VscodeSessionStore implements SessionStore {
  constructor(private readonly state: vscode.Memento) {}

  get<T>(key: string): T | undefined {
    return this.state.get<T>(key);
  }

  async update(key: string, value: unknown): Promise<void> {
    await this.state.update(key, value);
  }
}
