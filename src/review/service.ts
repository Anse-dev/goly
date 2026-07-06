/**
 * Review sessions backed by disposable worktrees.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import { expandTilde, err, ok, toError } from '../core/types.js';
import type { Result } from '../core/types.js';
import type { GitClient } from '../git/client.js';
import type { WorktreeService } from '../worktrees/service.js';

export interface ReviewSession {
  id: string;
  ref: string;
  worktreePath: string;
  branch: string;
  createdAt: number;
  notes: string[];
}

const STORAGE_KEY = 'goly.reviewSessions.v1';

export class ReviewService {
  private readonly sessions = new Map<string, ReviewSession>();

  constructor(
    private readonly git: GitClient,
    private readonly worktreeService: WorktreeService,
    private readonly globalState: vscode.Memento,
  ) {
    const stored = this.globalState.get<unknown>(STORAGE_KEY);
    if (Array.isArray(stored)) {
      for (const candidate of stored) {
        if (isReviewSession(candidate)) {
          this.sessions.set(candidate.id, candidate);
        }
      }
    }
  }

  async startReview(
    ref: string,
    remote = 'origin',
  ): Promise<Result<ReviewSession>> {
    const trimmedRef = ref.trim();
    if (!trimmedRef) {
      return err(new Error('A branch or pull-request ref is required'));
    }

    logger.info(`Starting review for ${trimmedRef}`);
    const fetchRef = trimmedRef.startsWith(`${remote}/`)
      ? trimmedRef.slice(remote.length + 1)
      : trimmedRef;
    const fetchResult = await this.git.fetch(remote, fetchRef);
    if (!fetchResult.ok) {
      return err(
        new Error(
          `Could not fetch ${trimmedRef}: ${fetchResult.error.message}`,
        ),
      );
    }

    const commitResult = await this.git.resolveRef('FETCH_HEAD');
    if (!commitResult.ok) {
      return err(
        new Error(
          `Could not resolve fetched ref: ${commitResult.error.message}`,
        ),
      );
    }

    const suffix = Date.now().toString(36);
    const safeRef = sanitizeRef(trimmedRef);
    const branchName = `review/${safeRef}-${suffix}`;
    const worktreePath = path.join(
      expandTilde(getConfig().baseDirectory),
      `review-${safeRef}-${suffix}`,
    );

    const createResult = await this.worktreeService.create(
      branchName,
      worktreePath,
      {
        createBranch: true,
        startPoint: commitResult.value,
        openInNewWindow: false,
      },
    );
    if (!createResult.ok) {
      return err(
        new Error(
          `Could not create review worktree: ${createResult.error.message}`,
        ),
      );
    }
    for (const warning of createResult.value.warnings) {
      logger.warn(`Review worktree warning: ${warning}`);
    }

    const session: ReviewSession = {
      id: `review-${suffix}`,
      ref: trimmedRef,
      worktreePath: createResult.value.worktree.path,
      branch: branchName,
      createdAt: Date.now(),
      notes: [],
    };
    this.sessions.set(session.id, session);
    await this.persist();

    try {
      await vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.file(session.worktreePath),
        { forceNewWindow: true },
      );
    } catch (error) {
      logger.warn(
        `Review created, but the window could not be opened: ${toError(error).message}`,
      );
    }

    return ok({ ...session, notes: [...session.notes] });
  }

  listSessions(): ReviewSession[] {
    return [...this.sessions.values()]
      .map((session) => ({ ...session, notes: [...session.notes] }))
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async addNote(sessionId: string, note: string): Promise<Result<void>> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return err(new Error('Review session not found'));
    }
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      return err(new Error('A note cannot be empty'));
    }
    session.notes.push(trimmedNote);
    await this.persist();
    return ok(undefined);
  }

  async endReview(
    sessionId: string,
    deleteBranch = true,
  ): Promise<Result<void>> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return err(new Error('Review session not found'));
    }

    logger.info(`Ending review session ${sessionId}`);
    if (!this.worktreeService.get(session.worktreePath)) {
      if (deleteBranch) {
        const branchResult = await this.git.deleteBranch(session.branch, true);
        if (!branchResult.ok) {
          return branchResult;
        }
      }
      this.sessions.delete(sessionId);
      await this.persist();
      return ok(undefined);
    }

    const removeResult = await this.worktreeService.remove(
      session.worktreePath,
      deleteBranch,
      deleteBranch,
    );
    if (!removeResult.ok) {
      return removeResult;
    }

    this.sessions.delete(sessionId);
    await this.persist();
    return ok(undefined);
  }

  async cleanupAll(deleteBranches = true): Promise<Result<void>> {
    const failures: string[] = [];
    for (const session of [...this.sessions.values()]) {
      const result = await this.endReview(session.id, deleteBranches);
      if (!result.ok) {
        failures.push(`${session.ref}: ${result.error.message}`);
      }
    }
    return failures.length === 0
      ? ok(undefined)
      : err(
          new Error(
            `Some review sessions could not be removed: ${failures.join('; ')}`,
          ),
        );
  }

  get(sessionId: string): ReviewSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { ...session, notes: [...session.notes] } : undefined;
  }

  private async persist(): Promise<void> {
    await this.globalState.update(STORAGE_KEY, [...this.sessions.values()]);
  }
}

function sanitizeRef(ref: string): string {
  const sanitized = ref
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return sanitized || 'change';
}

function isReviewSession(value: unknown): value is ReviewSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ReviewSession>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.ref === 'string' &&
    typeof candidate.worktreePath === 'string' &&
    typeof candidate.branch === 'string' &&
    typeof candidate.createdAt === 'number' &&
    Array.isArray(candidate.notes) &&
    candidate.notes.every((note) => typeof note === 'string')
  );
}
