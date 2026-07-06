import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { runTests } from '@vscode/test-electron';

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './integration/index.js');
  const testWorkspace = await fs.mkdtemp(
    path.join(tmpdir(), 'goly-vscode-test-'),
  );
  const vscodeExecutablePath = await findLocalVsCode();

  try {
    await execFileAsync('git', ['init', '-b', 'main', testWorkspace]);
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      ...(vscodeExecutablePath
        ? { vscodeExecutablePath }
        : { version: '1.100.0' }),
      launchArgs: [
        testWorkspace,
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox',
      ],
    });
  } finally {
    await fs.rm(testWorkspace, { recursive: true, force: true });
  }
}

async function findLocalVsCode(): Promise<string | undefined> {
  const candidates = [
    process.env.VSCODE_EXECUTABLE_PATH,
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    '/Applications/Visual Studio Code 2.app/Contents/MacOS/Code',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next known installation path.
    }
  }
  return undefined;
}

main().catch((error) => {
  console.error('Integration tests failed:', error);
  process.exitCode = 1;
});
