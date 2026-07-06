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
  portRangeStart: number;
  envFilePatterns: string[];
  postCreateCommands: string[];
  maxWorktreesFree: number;
}

const CONFIG_KEY = 'goly';

const DEFAULTS: GolyConfig = {
  baseDirectory: '~/workspaces',
  autoRefresh: true,
  refreshInterval: 5000,
  autoOpenInNewWindow: true,
  confirmBeforeDelete: true,
  confirmBeforeDeleteBranch: true,
  portRangeStart: 3000,
  envFilePatterns: ['.env.local', '.env.*.local', '*.env'],
  postCreateCommands: ['npm install'],
  maxWorktreesFree: 5,
};

export function getConfig(): GolyConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_KEY);
  return {
    baseDirectory: config.get('baseDirectory', DEFAULTS.baseDirectory),
    autoRefresh: config.get('autoRefresh', DEFAULTS.autoRefresh),
    refreshInterval: config.get('refreshInterval', DEFAULTS.refreshInterval),
    autoOpenInNewWindow: config.get('autoOpenInNewWindow', DEFAULTS.autoOpenInNewWindow),
    confirmBeforeDelete: config.get('confirmBeforeDelete', DEFAULTS.confirmBeforeDelete),
    confirmBeforeDeleteBranch: config.get('confirmBeforeDeleteBranch', DEFAULTS.confirmBeforeDeleteBranch),
    portRangeStart: config.get('portRangeStart', DEFAULTS.portRangeStart),
    envFilePatterns: config.get('envFilePatterns', DEFAULTS.envFilePatterns),
    postCreateCommands: config.get('postCreateCommands', DEFAULTS.postCreateCommands),
    maxWorktreesFree: config.get('maxWorktreesFree', DEFAULTS.maxWorktreesFree),
  };
}

export function onConfigChange(
  callback: (config: GolyConfig) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration(CONFIG_KEY)) {
      callback(getConfig());
    }
  });
}
