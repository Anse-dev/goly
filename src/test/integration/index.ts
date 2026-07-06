import * as assert from 'assert';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('goly-dev.goly');
  assert.ok(
    extension,
    'The Goly extension should be installed in the test host',
  );
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'goly.refresh',
    'goly.create',
    'goly.remove',
    'goly.open',
    'goly.terminal',
    'goly.snapshot',
    'goly.restoreSnapshot',
    'goly.review',
    'goly.endReview',
    'goly.copyEnv',
    'goly.compare',
  ]) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }
}
