/**
 * Logger using VS Code OutputChannel
 */

import * as vscode from 'vscode';

const LOG_CHANNEL_NAME = 'Goly';

class GolyLogger {
  private channel: vscode.OutputChannel | null = null;
  private level: 'debug' | 'info' | 'warn' | 'error' = 'debug';

  private getChannel(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel(LOG_CHANNEL_NAME);
    }
    return this.channel;
  }

  setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.level = level;
  }

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
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

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      const stack = error instanceof Error ? `\n${error.stack}` : '';
      this.log('ERROR', `${message}${stack}`, []);
    }
  }

  private log(level: string, message: string, args: unknown[]): void {
    const timestamp = new Date().toISOString().split('T')[1]?.split('.')[0] || '';
    const formatted = `[${timestamp}] [${level}] ${message}`;
    
    if (args.length > 0) {
      const data = args.map(a => 
        typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
      ).join(' ');
      this.getChannel().appendLine(`${formatted}\n${data}`);
    } else {
      this.getChannel().appendLine(formatted);
    }
    
    // Also log to console in dev
    if (process.env.NODE_ENV !== 'production') {
      console.log(formatted, ...args);
    }
  }

  show(): void {
    this.getChannel().show();
  }
}

export const logger = new GolyLogger();
