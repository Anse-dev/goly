/**
 * Cross-platform port and process inspection.
 */

import { execFile } from 'child_process';
import { platform } from 'os';
import * as path from 'path';
import { logger } from '../core/logger.js';
import { isPathInside, toError } from '../core/types.js';
import { identifyAgent } from '../domain/activity/agent-detector.js';

const COMMAND_TIMEOUT_MS = 5_000;

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

export interface PathActivity {
  ports: number[];
  processes: ProcessInfo[];
  hasAgent: boolean;
  agentName?: string;
}

interface CwdProcess {
  pid: number;
  name: string;
  cwd?: string;
  command: string;
}

export class ProcessInspector {
  private readonly currentPlatform = platform();

  async getListeningPorts(): Promise<PortInfo[]> {
    try {
      return this.currentPlatform === 'win32'
        ? await this.getListeningPortsWindows()
        : await this.getListeningPortsUnix();
    } catch (error) {
      logger.debug('Could not inspect listening ports', error);
      return [];
    }
  }

  async inspectPaths(
    worktreePaths: readonly string[],
  ): Promise<Map<string, PathActivity>> {
    const normalizedPaths = worktreePaths.map((worktreePath) =>
      path.resolve(worktreePath),
    );
    const result = new Map<string, PathActivity>(
      normalizedPaths.map((worktreePath) => [
        worktreePath,
        { ports: [], processes: [], hasAgent: false },
      ]),
    );

    try {
      const [ports, rawProcesses] = await Promise.all([
        this.getListeningPorts(),
        this.currentPlatform === 'win32'
          ? this.getProcessesWindows()
          : this.getProcessesUnix(normalizedPaths),
      ]);
      const portsByPid = groupPortsByPid(ports);

      for (const process of rawProcesses) {
        const ownerPath = findOwningWorktree(
          normalizedPaths,
          process,
          this.currentPlatform,
        );
        if (!ownerPath) {
          continue;
        }
        const activity = result.get(ownerPath);
        if (!activity) {
          continue;
        }

        const processPorts = portsByPid.get(process.pid) ?? [];
        const primaryPort = processPorts[0]?.port;
        activity.processes.push({
          pid: process.pid,
          name: process.name,
          command: process.command,
          cwd: process.cwd,
          port: primaryPort,
        });
        for (const portInfo of processPorts) {
          if (!activity.ports.includes(portInfo.port)) {
            activity.ports.push(portInfo.port);
          }
        }
      }

      for (const activity of result.values()) {
        activity.ports.sort((left, right) => left - right);
        activity.processes.sort((left, right) => left.pid - right.pid);
        const agent = identifyAgent(activity.processes);
        activity.hasAgent = agent !== undefined;
        activity.agentName = agent;
      }
    } catch (error) {
      logger.error('Could not inspect worktree activity', error);
    }

    return result;
  }

  async getProcessesForPath(worktreePath: string): Promise<ProcessInfo[]> {
    const normalizedPath = path.resolve(worktreePath);
    const activity = await this.inspectPaths([normalizedPath]);
    return activity.get(normalizedPath)?.processes ?? [];
  }

  async detectAgent(
    worktreePath: string,
  ): Promise<{ hasAgent: boolean; agentName?: string }> {
    const normalizedPath = path.resolve(worktreePath);
    const activity = await this.inspectPaths([normalizedPath]);
    const pathActivity = activity.get(normalizedPath);
    return {
      hasAgent: pathActivity?.hasAgent ?? false,
      agentName: pathActivity?.agentName,
    };
  }

  async getPortsForPath(worktreePath: string): Promise<number[]> {
    const normalizedPath = path.resolve(worktreePath);
    const activity = await this.inspectPaths([normalizedPath]);
    return activity.get(normalizedPath)?.ports ?? [];
  }

  async isPortAvailable(port: number): Promise<boolean> {
    if (!isValidPort(port)) {
      return false;
    }
    const ports = await this.getListeningPorts();
    return !ports.some((candidate) => candidate.port === port);
  }

  async findAvailablePort(start: number, end: number): Promise<number | null> {
    if (!isValidPort(start) || !isValidPort(end) || start > end) {
      return null;
    }

    const usedPorts = new Set(
      (await this.getListeningPorts()).map((port) => port.port),
    );
    for (let port = start; port <= end; port += 1) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }
    return null;
  }

  private async getListeningPortsUnix(): Promise<PortInfo[]> {
    try {
      const output = await executeFile('lsof', [
        '-nP',
        '-iTCP',
        '-sTCP:LISTEN',
        '-Fpcn',
      ]);
      return parseLsofPorts(output);
    } catch (error) {
      if (this.currentPlatform === 'linux') {
        return this.getListeningPortsLinuxFallback();
      }
      throw error;
    }
  }

  private async getListeningPortsLinuxFallback(): Promise<PortInfo[]> {
    const output = await executeFile('ss', ['-ltnpH']);
    const ports: PortInfo[] = [];
    for (const line of output.split(/\r?\n/)) {
      const addressMatch = /\s(\[[^\]]+\]|[^\s]+):(\d+)\s/.exec(` ${line} `);
      const pidMatch = /pid=(\d+)/.exec(line);
      if (!addressMatch) {
        continue;
      }
      const port = Number.parseInt(addressMatch[2] ?? '', 10);
      const pid = Number.parseInt(pidMatch?.[1] ?? '0', 10);
      if (!isValidPort(port)) {
        continue;
      }
      ports.push({
        port,
        pid,
        processName: /users:\(\("([^"]+)"/.exec(line)?.[1] ?? 'unknown',
        command: line.trim(),
        address: addressMatch[1] ?? '',
      });
    }
    return deduplicatePorts(ports);
  }

  private async getProcessesUnix(
    worktreePaths: readonly string[],
  ): Promise<CwdProcess[]> {
    let output: string;
    try {
      output = await executeFile('lsof', ['-a', '-d', 'cwd', '-Fpcn']);
    } catch {
      return [];
    }

    const cwdProcesses = parseLsofCwdProcesses(output).filter(
      (process) =>
        process.cwd &&
        worktreePaths.some((worktreePath) =>
          isPathInside(worktreePath, process.cwd ?? ''),
        ),
    );
    return Promise.all(
      cwdProcesses.map(async (process) => {
        try {
          const command = (
            await executeFile('ps', [
              '-p',
              String(process.pid),
              '-o',
              'command=',
            ])
          ).trim();
          return { ...process, command: command || process.name };
        } catch {
          return process;
        }
      }),
    );
  }

  private async getListeningPortsWindows(): Promise<PortInfo[]> {
    const output = await executeFile('netstat', ['-ano', '-p', 'tcp']);
    const ports: PortInfo[] = [];

    for (const line of output.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 5 || fields[0]?.toUpperCase() !== 'TCP') {
        continue;
      }
      if (fields[3]?.toUpperCase() !== 'LISTENING') {
        continue;
      }
      const localAddress = fields[1] ?? '';
      const portMatch = /:(\d+)$/.exec(localAddress);
      const port = Number.parseInt(portMatch?.[1] ?? '', 10);
      const pid = Number.parseInt(fields[4] ?? '', 10);
      if (!isValidPort(port) || !Number.isInteger(pid)) {
        continue;
      }
      ports.push({
        port,
        pid,
        processName: 'unknown',
        command: line.trim(),
        address: localAddress,
      });
    }
    return deduplicatePorts(ports);
  }

  private async getProcessesWindows(): Promise<CwdProcess[]> {
    const script = [
      'Get-CimInstance Win32_Process',
      'Select-Object ProcessId,Name,CommandLine',
      'ConvertTo-Json -Compress',
    ].join(' | ');
    const output = await executeFile('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    if (!output.trim()) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch (error) {
      logger.debug('Could not parse Windows process list', toError(error));
      return [];
    }

    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.flatMap((entry) => {
      if (!isWindowsProcess(entry)) {
        return [];
      }
      return [
        {
          pid: entry.ProcessId,
          name: entry.Name,
          command: entry.CommandLine ?? entry.Name,
        },
      ];
    });
  }
}

export function parseLsofPorts(output: string): PortInfo[] {
  const ports: PortInfo[] = [];
  let pid = 0;
  let processName = 'unknown';

  for (const field of output.split(/\r?\n/)) {
    const type = field[0];
    const value = field.slice(1);
    if (type === 'p') {
      pid = Number.parseInt(value, 10);
    } else if (type === 'c') {
      processName = value || 'unknown';
    } else if (type === 'n') {
      const match = /:(\d+)(?:\s+\(LISTEN\))?$/.exec(value);
      const port = Number.parseInt(match?.[1] ?? '', 10);
      if (Number.isInteger(pid) && isValidPort(port)) {
        ports.push({
          port,
          pid,
          processName,
          command: processName,
          address: value,
        });
      }
    }
  }
  return deduplicatePorts(ports);
}

export function parseLsofCwdProcesses(output: string): CwdProcess[] {
  const processes: CwdProcess[] = [];
  let current: CwdProcess | undefined;

  const flush = (): void => {
    if (current?.pid && current.cwd) {
      processes.push(current);
    }
  };

  for (const field of output.split(/\r?\n/)) {
    const type = field[0];
    const value = field.slice(1);
    if (type === 'p') {
      flush();
      current = {
        pid: Number.parseInt(value, 10),
        name: 'unknown',
        command: 'unknown',
      };
    } else if (type === 'c' && current) {
      current.name = value || 'unknown';
      current.command = current.name;
    } else if (type === 'n' && current) {
      current.cwd = value;
    }
  }
  flush();
  return processes;
}

function executeFile(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const stderrText = String(stderr).trim();
          if (stderrText && !error.message.includes(stderrText)) {
            error.message = `${error.message}: ${stderrText}`;
          }
          reject(error);
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

function groupPortsByPid(ports: readonly PortInfo[]): Map<number, PortInfo[]> {
  const grouped = new Map<number, PortInfo[]>();
  for (const port of ports) {
    const entries = grouped.get(port.pid) ?? [];
    entries.push(port);
    grouped.set(port.pid, entries);
  }
  return grouped;
}

function findOwningWorktree(
  worktreePaths: readonly string[],
  process: CwdProcess,
  currentPlatform: NodeJS.Platform,
): string | undefined {
  const sorted = [...worktreePaths].sort(
    (left, right) => right.length - left.length,
  );
  if (process.cwd) {
    const cwd = process.cwd;
    return sorted.find((worktreePath) => isPathInside(worktreePath, cwd));
  }
  if (currentPlatform === 'win32') {
    const command = process.command.toLowerCase();
    return sorted.find((worktreePath) =>
      command.includes(worktreePath.toLowerCase()),
    );
  }
  return undefined;
}

function deduplicatePorts(ports: readonly PortInfo[]): PortInfo[] {
  const unique = new Map<string, PortInfo>();
  for (const port of ports) {
    unique.set(`${port.pid}:${port.port}`, port);
  }
  return [...unique.values()];
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

interface WindowsProcessRecord {
  ProcessId: number;
  Name: string;
  CommandLine?: string | null;
}

function isWindowsProcess(value: unknown): value is WindowsProcessRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<WindowsProcessRecord>;
  return Number.isInteger(record.ProcessId) && typeof record.Name === 'string';
}
