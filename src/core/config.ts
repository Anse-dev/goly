/**
 * Configuration management for Goly
 */

import * as vscode from 'vscode';

export interface GolyConfig {
  baseDirectory: string;
  autoRefresh: boolean;
  refreshInterval: number;
  autoOpenInNewWindow: boolean;
  confirmBeforeDelete: boolean;
  confirmBeforeDeleteBranch: boolean;
  envFilePatterns: string[];
  postCreateCommands: string[];
  confirmBeforePostCreateCommands: boolean;
  maxWorktrees: number;
}

const CONFIG_KEY = 'goly';

const DEFAULTS: GolyConfig = {
  baseDirectory: '~/workspaces',
  autoRefresh: true,
  refreshInterval: 15000,
  autoOpenInNewWindow: true,
  confirmBeforeDelete: true,
  confirmBeforeDeleteBranch: true,
  envFilePatterns: ['.env', '.env.local', '.env.*', '*.env'],
  postCreateCommands: [],
  confirmBeforePostCreateCommands: true,
  maxWorktrees: 0,
};

export function getConfig(): GolyConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_KEY);
  const envFilePatterns = config.get<unknown>(
    'envFilePatterns',
    DEFAULTS.envFilePatterns,
  );
  const postCreateCommands = config.get<unknown>(
    'postCreateCommands',
    DEFAULTS.postCreateCommands,
  );

  return {
    baseDirectory: nonEmptyString(
      config.get('baseDirectory', DEFAULTS.baseDirectory),
      DEFAULTS.baseDirectory,
    ),
    autoRefresh: config.get('autoRefresh', DEFAULTS.autoRefresh),
    refreshInterval: nonNegativeNumber(
      config.get('refreshInterval', DEFAULTS.refreshInterval),
      DEFAULTS.refreshInterval,
    ),
    autoOpenInNewWindow: config.get(
      'autoOpenInNewWindow',
      DEFAULTS.autoOpenInNewWindow,
    ),
    confirmBeforeDelete: config.get(
      'confirmBeforeDelete',
      DEFAULTS.confirmBeforeDelete,
    ),
    confirmBeforeDeleteBranch: config.get(
      'confirmBeforeDeleteBranch',
      DEFAULTS.confirmBeforeDeleteBranch,
    ),
    envFilePatterns: stringArray(envFilePatterns, DEFAULTS.envFilePatterns),
    postCreateCommands: stringArray(
      postCreateCommands,
      DEFAULTS.postCreateCommands,
    ),
    confirmBeforePostCreateCommands: config.get(
      'confirmBeforePostCreateCommands',
      DEFAULTS.confirmBeforePostCreateCommands,
    ),
    maxWorktrees: nonNegativeNumber(
      config.get('maxWorktrees', DEFAULTS.maxWorktrees),
      DEFAULTS.maxWorktrees,
    ),
  };
}

export function onConfigChange(
  callback: (config: GolyConfig) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONFIG_KEY)) {
      callback(getConfig());
    }
  });
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return strings.length > 0 ? strings : [...fallback];
}
