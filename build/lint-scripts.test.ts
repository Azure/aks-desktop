// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { embeddedPython, normalizePipelineExpressions, workflowScripts } from './lint-scripts.ts';

test('collects GitHub run scripts with inherited and explicit shells, not github-script JavaScript', () => {
  const scripts = workflowScripts('workflow.yml', `
on: push
jobs:
  linux:
    runs-on: ubuntu-latest
    defaults:
      run:
        shell: bash
    steps:
      - run: echo hello
      - run: Write-Output hello
        shell: pwsh
      - uses: actions/github-script
        with:
          script: console.log("not shell")
  windows:
    runs-on: windows-latest
    steps:
      - run: Write-Output hello
`);
  assert.deepEqual(scripts.map(script => script.language), ['bash', 'powershell', 'powershell']);
  assert.throws(() => workflowScripts('bad.yml', 'jobs: ['), /bad.yml/);
});

test('collects nested Azure pipeline scripts, including PowerShell task inputs', () => {
  const scripts = workflowScripts('pipeline.yml', `
extends:
  parameters:
    stages:
      - jobs:
          - steps:
              - bash: echo hello
              - powershell: Write-Output hello
              - script: echo mac
              - task: PowerShell@2
                inputs:
                  script: Write-Output task
`);
  assert.deepEqual(scripts.map(script => script.language), ['bash', 'powershell', 'bash', 'powershell']);
});

test('replaces pipeline substitutions without concealing real command substitutions', () => {
  assert.equal(
    normalizePipelineExpressions('echo "${{ matrix.arch }}" "$(Build.SourcesDirectory)" "$(CACHE)" "$(pwd)"'),
    'echo "CI_EXPRESSION" "CI_EXPRESSION" "CI_EXPRESSION" "$(pwd)"'
  );
});

test('extracts decoded Python commands without executing build code, rejecting dynamic snippets', () => {
  const scripts = embeddedPython('build/example.ts', `
throw new Error('must not execute');
execFileSync(pythonExecutable, ['-c', 'import sys; print("\\\\n".join(sys.argv))']);
execFileSync('python3', ['-c', \`print("ok")\`]);
execFileSync('node', ['-c', 'not Python']);
`);
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0].source, 'import sys; print("\\n".join(sys.argv))');
  assert.equal(scripts[0].name, 'build/example.ts:3.py');
  assert.throws(
    () => embeddedPython('dynamic.ts', "execFileSync(python, ['-c', code])"),
    /static string/
  );
});

test('the configured analyzers reject Python mistakes and Bash warnings', () => {
  const python = spawnSync('ruff', ['check', '--no-cache', '--select', 'F', '-'], {
    input: 'print(undefined_name)\n', encoding: 'utf8',
  });
  assert.ifError(python.error);
  assert.equal(python.status, 1, python.stderr);
  assert.match(python.stdout, /F821/);

  const shell = spawnSync('shellcheck', ['--severity=warning', '--shell=bash', '-'], {
    input: 'export value=$(false)\n', encoding: 'utf8',
  });
  assert.ifError(shell.error);
  assert.equal(shell.status, 1, shell.stderr);
  assert.match(shell.stdout, /SC2155/);
});

test('the repository command fails when a newly added Python script has a diagnostic', context => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = fs.mkdtempSync(path.join(root, 'build/.lint-fixture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'invalid.py'), 'print(undefined_name)\n');
  const result = spawnSync(process.execPath, [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--experimental-strip-types',
    'build/lint-scripts.ts',
  ], { cwd: root, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /invalid.py/);
  assert.match(result.stdout, /F821/);
});
