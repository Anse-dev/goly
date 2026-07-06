import { describe, expect, it } from 'vitest';
import { parseLsofCwdProcesses, parseLsofPorts } from '../ports/inspector.js';

describe('lsof parsers', () => {
  it('parses and deduplicates listening ports', () => {
    const output = [
      'p42',
      'cnode',
      'f10',
      'n127.0.0.1:3000',
      'f11',
      'n[::1]:3000',
      'f12',
      'n*:4000',
      '',
    ].join('\n');

    expect(parseLsofPorts(output)).toEqual([
      {
        port: 3000,
        pid: 42,
        processName: 'node',
        command: 'node',
        address: '[::1]:3000',
      },
      {
        port: 4000,
        pid: 42,
        processName: 'node',
        command: 'node',
        address: '*:4000',
      },
    ]);
  });

  it('parses process working directories', () => {
    const output = [
      'p42',
      'cnode',
      'fcwd',
      'n/Users/test/work tree',
      'p43',
      'ccodex',
      'fcwd',
      'n/Users/test/other',
      '',
    ].join('\n');

    expect(parseLsofCwdProcesses(output)).toEqual([
      {
        pid: 42,
        name: 'node',
        command: 'node',
        cwd: '/Users/test/work tree',
      },
      {
        pid: 43,
        name: 'codex',
        command: 'codex',
        cwd: '/Users/test/other',
      },
    ]);
  });
});
