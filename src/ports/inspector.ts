/**
 * Port and Process Inspector - Cross-platform implementation
 * 
 * Detects listening ports and running processes by worktree directory.
 * Uses platform-specific commands (lsof on mac/linux, netstat on windows) .
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../core/logger.js';
import { retry } from '../core/types.js';
import { platform } from 'os';

const execAsync = promisify(exec);

export interface PortInfo {
  port: number;
  pid: number;
  processName: string;
  command: string;
  address: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  cwd?: string;
  port?: number;
}

// Agent detection patterns
const AGENT_PATTERNS = [
  { name: 'Claude Code', patterns: ['claude', 'anthropic'] },
  { name: 'Codex', patterns: ['codex', 'openai'] },
  { name: 'Cursor', patterns: ['cursor'] },
  { name: 'Windsurf', patterns: ['windsurf', 'codeium'] },
  { name: 'Copilot', patterns: ['copilot', 'github'] },
];

export class ProcessInspector {
  private platform: string;

  constructor() {
    this.platform = platform();
  }

  /**
   * Get all listening ports
   */
  async getListeningPorts(): Promise<PortInfo[]> {
    try {
      if (this.platform === 'win32') {
        return await this.getListeningPortsWindows();
      } else {
        return await this.getListeningPortsUnix();
      }
    } catch (e) {
      logger.error('Failed to get listening ports', e);
      return [];
    }
  }

  /**
   * Get processes for a specific worktree directory
   */
  async getProcessesForPath(worktreePath: string): Promise<ProcessInfo[]> {
    try {
      if (this.platform === 'win32') {
        return await this.getProcessesForPathWindows(worktreePath);
      } else {
        return await this.getProcessesForPathUnix(worktreePath);
      }
    } catch (e) {
      logger.error('Failed to get processes for path', e);
      return [];
    }
  }

  /**
   * Detect if an agent is running in the worktree
   */
  async detectAgent(worktreePath: string): Promise<{ hasAgent: boolean; agentName?: string }> {
    const processes = await this.getProcessesForPath(worktreePath);
    
    for (const proc of processes) {
      const lowerName = proc.name.toLowerCase();
      for (const agent of AGENT_PATTERNS) {
        if (agent.patterns.some(p => lowerName.includes(p))) {
          return { hasAgent: true, agentName: agent.name };
        }
      }
    }
    
    return { hasAgent: false };
  }

  /**
   * Get ports used by a worktree
   */
  async getPortsForPath(worktreePath: string): Promise<number[]> {
    const ports = new Set<number>();
    const processes = await this.getProcessesForPath(worktreePath);
    
    for (const proc of processes) {
      if (proc.port) {
        ports.add(proc.port);
      }
    }
    
    return Array.from(ports);
  }

  /**
   * Check if a port is available
   */
  async isPortAvailable(port: number): Promise<boolean> {
    const ports = await this.getListeningPorts();
    return !ports.some(p => p.port === port);
  }

  /**
   * Find next available port in range
   */
  async findAvailablePort(start: number, end: number): Promise<number | null> {
    const ports = await this.getListeningPorts();
    const usedPorts = new Set(ports.map(p => p.port));
    
    for (let port = start; port <= end; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }
    
    return null;
  }

  // Unix/macOS implementation
  private async getListeningPortsUnix(): Promise<PortInfo[]> {
    const { stdout } = await execAsync(
      'lsof -i -P -n -sTCP:LISTEN 2>/dev/null | tail -n +2',
      { encoding: 'utf-8' }
    );

    const ports: PortInfo[] = [];
    const lines = stdout.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const [name, pid, user, fd, type, proto, state, addr] = parts;
      const addrParts = addr.split(':');
      const port = parseInt(addrParts[addrParts.length - 1] || '', 10);
      
      if (!isNaN(port)) {
        ports.push({
          port,
          pid: parseInt(pid, 10),
          processName: name,
          command: line,
          address: addr,
        });
      }
    }

    return ports;
  }

  private async getProcessesForPathUnix(worktreePath: string): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await execAsync(
        `lsof -a -d cwd -c '' 2>/dev/null | grep '${worktreePath}' || true`,
        { encoding: 'utf-8' }
      );

      const processes: ProcessInfo[] = [];
      const pids = new Set<number>();

      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          pids.add(parseInt(parts[1], 10));
        }
      }

      for (const pid of pids) {
        try {
          const { stdout: psOut } = await execAsync(
            `ps -p ${pid} -o comm= -o args= 2>/dev/null`,
            { encoding: 'utf-8' }
          );
          const [name, ...cmdParts] = (psOut.trim() || '').split(/\s+/);
          if (name) {
            processes.push({
              pid,
              name,
              command: cmdParts.join(' ') || name,
            });
          }
        } catch {
          // Process may have ended
        }
      }

      // Also check for processes with the path in command line
      try {
        const { stdout: grepOut } = await execAsync(
          `pgrep -f '${worktreePath}' 2>/dev/null || true`,
          { encoding: 'utf-8' }
        );

        for (const pidLine of grepOut.split('\n')) {
          const pid = parseInt(pidLine.trim(), 10);
          if (!isNaN(pid) && !pids.has(pid)) {
            try {
              const { stdout: psOut } = await execAsync(
                `ps -p ${pid} -o comm= -o args= 2>/dev/null`,
                { encoding: 'utf-8' }
              );
              const [name, ...cmdParts] = (psOut.trim() || '').split(/\s+/);
              if (name) {
                processes.push({
                  pid,
                  name,
                  command: cmdParts.join(' ') || name,
                });
              }
            } catch {
              // Ignore
            }
          }
        }
      } catch {
        // Ignore
      }

      return processes;
    } catch (e) {
      logger.debug('Failed to get processes for path', e);
      return [];
    }
  }

  // Windows implementation
  private async getListeningPortsWindows(): Promise<PortInfo[]> {
    try {
      const { stdout } = await execAsync(
        'netstat -ano | findstr LISTENING',
        { encoding: 'utf-8' }
      );

      const ports: PortInfo[] = [];
      const lines = stdout.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;

        const localAddr = parts[1];
        const addrParts = localAddr.split(':');
        const port = parseInt(addrParts[addrParts.length - 1] || '', 10);
        const pid = parseInt(parts[4] || '', 10);

        if (!isNaN(port) && !isNaN(pid)) {
          let processName = 'unknown';
          try {
            const { stdout: nameOut } = await execAsync(
              `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
              { encoding: 'utf-8' }
            );
            processName = nameOut.split(',')[0]?.replace(/"/g, '') || 'unknown';
          } catch {
            // Ignore
          }

          ports.push({
            port,
            pid,
            processName,
            command: line,
            address: localAddr,
          });
        }
      }

      return ports;
    } catch {
      return [];
    }
  }

  private async getProcessesForPathWindows(_worktreePath: string): Promise<ProcessInfo[]> {
    // Windows process detection is more complex
    // For now, return empty - would need PowerShell or WMI
    return [];
  }
}
