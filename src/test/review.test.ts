import { beforeEach, describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { __resetMock, __getExecutedCommands } from './vscode.mock.js';
import { ok } from '../core/types.js';
import type { GitClient } from '../git/client.js';
import { ReviewService } from '../review/service.js';
import type { WorktreeInfo, WorktreeService } from '../worktrees/service.js';

beforeEach(() => {
  __resetMock();
});

describe('ReviewService', () => {
  it('creates a disposable review worktree from a fetched ref', async () => {
    const memento = new MemoryMemento();
    const calls: Array<{ remote: string; ref?: string }> = [];
    const git = {
      fetch: async (remote: string, ref?: string) => {
        calls.push({ remote, ref });
        return ok(undefined);
      },
      resolveRef: async (ref: string) => ok(`${ref}-sha`),
    } as unknown as GitClient;
    const worktreeService = {
      create: async (
        branch: string,
        worktreePath: string,
        options: {
          createBranch?: boolean;
          startPoint?: string;
          openInNewWindow?: boolean;
        },
      ) =>
        ok({
          worktree: makeWorktree(worktreePath, branch),
          opened: false,
          warnings: [],
          options,
        }),
    } as unknown as WorktreeService;

    const service = new ReviewService(
      git,
      worktreeService,
      memento as vscode.Memento,
    );
    const result = await service.startReview('origin/feature/payment');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(calls).toEqual([{ remote: 'origin', ref: 'feature/payment' }]);
    expect(result.value.ref).toBe('origin/feature/payment');
    expect(result.value.branch).toMatch(/^review\/origin-feature-payment-/);
    expect(service.listSessions()).toHaveLength(1);
    expect(__getExecutedCommands()[0]?.[0]).toBe('vscode.openFolder');
  });

  it('cleans up a stored review session whose worktree is already gone', async () => {
    const memento = new MemoryMemento();
    const deletedBranches: string[] = [];
    await memento.update('goly.reviewSessions.v1', [
      {
        id: 'review-1',
        ref: 'refs/pull/1/head',
        worktreePath: '/tmp/missing-review',
        branch: 'review/pr-1',
        createdAt: 1,
        notes: [],
      },
    ]);
    const git = {
      deleteBranch: async (branch: string) => {
        deletedBranches.push(branch);
        return ok(undefined);
      },
    } as unknown as GitClient;
    const worktreeService = {
      get: () => undefined,
    } as unknown as WorktreeService;

    const service = new ReviewService(
      git,
      worktreeService,
      memento as vscode.Memento,
    );
    const result = await service.endReview('review-1');

    expect(result.ok).toBe(true);
    expect(deletedBranches).toEqual(['review/pr-1']);
    expect(service.listSessions()).toEqual([]);
  });
});

class MemoryMemento {
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

function makeWorktree(worktreePath: string, branch: string): WorktreeInfo {
  return {
    id: 'review-worktree',
    path: worktreePath,
    name: 'review',
    branch,
    isMain: false,
    status: {
      branch,
      isClean: true,
      modified: [],
      staged: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    },
    lastActivity: 1,
    ports: [],
    processes: [],
    hasAgent: false,
  };
}
