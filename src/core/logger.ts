/**
 * Logger using VS Code OutputChannel
 */

import * as vscode from 'vscode';

const LOG_CHANNEL_NAME = 'Goly';
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

class GolyLogger {
  private channel: vscode.OutputChannel | null = null;
  private level: LogLevel = 'info';

  private getChannel(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel(LOG_CHANNEL_NAME);
    }
    return this.channel;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(this.level);
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      this.log('DEBUG', message, args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      this.log('INFO', message, args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      this.log('WARN', message, args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      const extras = args
        .map((a) =>
          a instanceof Error ? (a.stack ?? a.message) : this.serialize(a),
        )
        .join('\n');
      this.log('ERROR', extras ? `${message}\n${extras}` : message, []);
    }
  }

  private log(level: string, message: string, args: unknown[]): void {
    const timestamp = new Date().toISOString().slice(11, 19);
    const formatted = `[${timestamp}] [${level}] ${message}`;

    if (args.length > 0) {
      const data = args.map((a) => this.serialize(a)).join(' ');
      this.getChannel().appendLine(`${formatted}\n${data}`);
    } else {
      this.getChannel().appendLine(formatted);
    }

    // Mirror to the developer console only when explicitly requested.
    if (process.env.NODE_ENV === 'development') {
      console.log(formatted, ...args);
    }
  }

  show(): void {
    this.getChannel().show();
  }

  dispose(): void {
    this.channel?.dispose();
    this.channel = null;
  }

  private serialize(value: unknown): string {
    if (value instanceof Error) {
      return value.stack ?? value.message;
    }
    if (typeof value !== 'object' || value === null) {
      return String(value);
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
}

export const logger = new GolyLogger();
