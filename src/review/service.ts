/**
 * Review Mode Service
 * 
 * Creates ephemeral worktrees for PR/branch review with auto-cleanup.
 */

import * as vscode from 'vscode';
import { GitClient } from '../git/client.js';
import { WorktreeService } from '../worktrees/service.js';
import { logger } from '../core/logger.js';
import { getConfig } from '../core/config.js';
import { expandTilde, getBasename } from '../core/types.js';

export interface ReviewSession {
  id: string;
  ref: string;
  worktreePath: string;
  branch: string;
  createdAt: number;
  notes: string[];
}

export class ReviewService {
  private sessions = new Map<string, ReviewSession>();
  private config = getConfig();

  constructor(
    private git: GitClient,
    private worktreeService: WorktreeService
  ) {}

  /**
   * Start a review session for a branch or PR
   */
  async startReview(ref: string, remote = 'origin'): Promise<Result<ReviewSession>> {
    logger.info(`Starting review for: ${ref}`);

    // Fetch the ref first
    const fetchResult = await this.git.fetch(remote, ref);
    if (!fetchResult.ok) {
      return { ok: false, error: new Error(`Failed to fetch ${ref}: ${fetchResult.error}`) };
    }

    // Create ephemeral worktree name
    const safeRef = ref.replace(/[^a-zA-Z0-9-_]/g, '-');
    const branchName = `review/${safeRef}`;
    const worktreeDir = expandTilde(this.config.baseDirectory);
    const worktreePath = `${worktreeDir}/review-${safeRef}`;

    // Create the worktree
    const createResult = await this.worktreeService.create(
      branchName,
      worktreePath,
      true,
      false // Don't open yet
    );

    if (!createResult.ok) {
      return { ok: false, error: new Error(`Failed to create worktree: ${createResult.error}`) };
    }

    const session: ReviewSession = {
      id: `review-${Date.now()}`,
      ref,
      worktreePath,
      branch: branchName,
      createdAt: Date.now(),
      notes: [],
    };

    this.sessions.set(session.id, session);

    // Open in new window
    try {
      await vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.file(worktreePath),
        { newWindow: true }
      );
    } catch (e) {
      logger.warn('Failed to open review window', e);
    }

    return { ok: true, value: session };
  }

  /**
   * List active review sessions
   */
  listSessions(): ReviewSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Add a note to a review session
   */
  addNote(sessionId: string, note: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.notes.push(note);
    }
  }

  /**
   * End and cleanup a review session
   */
  async endReview(sessionId: string, deleteBranch = false): Promise<Result<void>> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: new Error('Session not found') };
    }

    logger.info(`Ending review session: ${sessionId}`);

    // Remove the worktree
    const removeResult = await this.worktreeService.remove(session.worktreePath, deleteBranch);
    if (!removeResult.ok) {
      logger.warn('Failed to remove worktree, manual cleanup may be needed', removeResult.error);
    }

    this.sessions.delete(sessionId);
    return { ok: true, value: undefined as void };
  }

  /**
   * Cleanup all review sessions
   */
  async cleanupAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await this.endReview(session.id, false);
    }
  }

  /**
   * Get session by ID
   */
  get(sessionId: string): ReviewSession | undefined {
    return this.sessions.get(sessionId);
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
