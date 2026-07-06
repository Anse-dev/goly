/**
 * Core types and utilities for Goly
 */

import { homedir } from 'os';
import * as path from 'path';

// Result type for error handling
export type Result<T, E = Error> =
  { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// Disposable helper
export type Disposable = {
  dispose(): void;
};

// Event emitter for internal events
export class EventBus<T extends object> implements Disposable {
  private listeners = new Map<keyof T, Set<(data: unknown) => void>>();

  constructor(
    private readonly onListenerError?: (event: keyof T, error: unknown) => void,
  ) {}

  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): Disposable {
    const listeners =
      this.listeners.get(event) ?? new Set<(data: unknown) => void>();
    const listener = (data: unknown): void => handler(data as T[K]);
    listeners.add(listener);
    this.listeners.set(event, listeners);

    return {
      dispose: () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listeners.delete(event);
        }
      },
    };
  }

  emit<K extends keyof T>(event: K, data: T[K]): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        this.onListenerError?.(event, e);
      }
    });
  }

  dispose(): void {
    this.listeners.clear();
  }
}

// Debounce utility
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): ((...args: Args) => void) & { cancel(): void } {
  let timeout: NodeJS.Timeout | null = null;
  const debounced = (...args: Args): void => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      fn(...args);
    }, ms);
  };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
}

// Path utilities
export function expandTilde(inputPath: string): string {
  if (inputPath === '~') {
    return homedir();
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function isPathInside(
  parentPath: string,
  candidatePath: string,
): boolean {
  const relative = path.relative(
    path.resolve(parentPath),
    path.resolve(candidatePath),
  );
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
