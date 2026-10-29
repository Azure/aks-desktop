// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test, { type TestContext } from 'node:test';

import { runWindowsBatch, windowsBatchInvocation } from './windows-batch';

const env = { SystemRoot: 'C:\\Windows' };
const isWindows = { skip: process.platform !== 'win32' };

test('runs batch files through the in-box cmd.exe with a quoted path', () => {
  assert.deepEqual(windowsBatchInvocation('C:\\Program Files\\az (x)\\bin\\az.cmd', ['version', '--output', 'json'], env), {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', '""C:\\Program Files\\az (x)\\bin\\az.cmd" version --output json"'],
    windowsVerbatimArguments: true,
  });
});

test('rejects inputs cmd.exe would interpret', () => {
  assert.throws(() => windowsBatchInvocation('C:\\tools\\az.exe', [], env), /Expected a \.cmd or \.bat file/);
  for (const scriptPath of ['C:\\a"b\\az.cmd', 'C:\\%PATH%\\az.cmd', 'C:\\a!b\\az.cmd']) {
    assert.throws(() => windowsBatchInvocation(scriptPath, [], env), /characters cmd\.exe would interpret/);
  }
  for (const arg of ['two words', 'a&b', 'a|b', '%PATH%', '"quoted"', '^', '']) {
    assert.throws(() => windowsBatchInvocation('C:\\az.cmd', [arg], env), /must be plain text/);
  }
});

function batchFixture(t: TestContext, body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aks batch & (tools) ^ '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'bin dir', 'az.cmd');
  fs.mkdirSync(path.dirname(script));
  fs.writeFileSync(script, `@echo off\r\n${body}\r\n`);
  return script;
}

test('Node refuses to spawn a batch file directly', isWindows, t => {
  const script = batchFixture(t, 'echo direct');
  assert.throws(() => execFileSync(script, ['version']), { code: 'EINVAL' });
});

test('runs a batch file under a path with spaces and cmd metacharacters', isWindows, t => {
  const script = batchFixture(t, 'echo [%~1][%~2][%~3]\r\necho "%~dp0"\r\nset "AZURE_EXTENSION_DIR=%~dp0..\\ext"\r\necho "%AZURE_EXTENSION_DIR%"');
  const lines = runWindowsBatch(script, ['version', '--output', 'json']).trim().split(/\r?\n/);
  assert.deepEqual(lines, [
    '[version][--output][json]',
    `"${path.dirname(script)}\\"`,
    `"${path.dirname(script)}\\..\\ext"`,
  ]);
});

test('reports the batch file exit code and stderr', isWindows, t => {
  const script = batchFixture(t, 'echo failure detail 1>&2\r\nexit /b 3');
  assert.throws(() => runWindowsBatch(script, ['version']), /az\.cmd version exited with 3: failure detail/);
});

test('passes the environment to the batch file', isWindows, t => {
  const script = batchFixture(t, 'echo %AKS_BATCH_TEST%');
  assert.equal(
    runWindowsBatch(script, [], { env: { ...process.env, AKS_BATCH_TEST: 'from-env' } }).trim(),
    'from-env'
  );
});
