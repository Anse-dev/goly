/**
 * Core types and utilities for Goly
 */

// Result type for error handling
export type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

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
export class EventBus<T extends Record<string, unknown[]>> {
  private listeners = new Map<keyof T, Set<(data: T[K]) => void>>();

  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): Disposable {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (data: unknown) => void);
    return {
      dispose: () => this.listeners.get(event)?.delete(handler as (data: unknown) => void),
    };
  }

  emit<K extends keyof T>(event: K, data: T[K]): void {
    this.listeners.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (e) {
        console.error(`Event handler error for ${String(event)}:`, e);
      }
    });
  }
}

// Debounce utility
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): T & { cancel(): void } {
  let timeout: NodeJS.Timeout | null = null;
  const debounced = ((...args: unknown[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  }) as T & { cancel(): void };
  debounced.cancel = () => {
    if (timeout) clearTimeout(timeout);
  };
  return debounced;
}

// Throttle utility
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): T {
  let lastCall = 0;
  return ((...args: unknown[]) => {
    const now = Date.now();
    if (now - lastCall >= ms) {
      lastCall = now;
      fn(...args);
    }
  }) as T;
}

// Timeout wrapper
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// Retry with exponential backoff
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 100
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}

// Path utilities
export function expandTilde(path: string): string {
  if (path.startsWith('~/') || path === '~') {
    return path.replace('~', process.env.HOME || '');
  }
  return path;
}

export function getBasename(path: string): string {
  return path.split('/').pop() || path;
}

export function getDirname(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}
