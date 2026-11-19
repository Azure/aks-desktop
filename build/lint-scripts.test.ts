// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { embeddedPython, normalizePipelineExpressions, workflowScripts } from './lint-scripts.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

function lintRepository(...args: string[]) {
  return spawnSync(process.execPath, [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--experimental-strip-types',
    'build/lint-scripts.ts',
    ...args,
  ], {
    cwd: root, encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.excludesFile',
      GIT_CONFIG_VALUE_0: devNull,
    },
  });
}

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
    'echo "${CI_EXPRESSION}" "${CI_EXPRESSION}" "${CI_EXPRESSION}" "$(pwd)"'
  );
});

test('pipeline condition placeholders remain runtime values for each script language', () => {
  const shell = workflowScripts('workflow.yml', `
on: push
jobs:
  conditions:
    runs-on: ubuntu-latest
    steps:
      - run: |
          if [ -z "\${{ github.ref }}" ]; then echo empty; fi
          if [ -n "$(BUILD_ID)" ]; then echo populated; fi
`);
  const result = spawnSync('shellcheck', ['--severity=warning', '--shell=bash', '-'], {
    input: shell[0].source, encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(
    normalizePipelineExpressions('Write-Output "$(BUILD_ID)"', 'powershell'),
    'Write-Output "$env:CI_EXPRESSION"'
  );
  assert.equal(
    normalizePipelineExpressions('print("${{ matrix.arch }}")', 'python'),
    'print("CI_EXPRESSION")'
  );
});

test('extracts annotated raw Python without cooking escapes or executing its module', () => {
  const raw = String.raw`print(r"\d+\n")`;
  const source = [
    'throw new Error("must not execute");',
    '// language=Python',
    'export const script = String.raw`' + raw + '`.replace("__VERSION__", version);',
    'export const javascript = String.raw`console.log("not Python")`;',
  ].join('\n');
  const scripts = embeddedPython('template.ts', source);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].source, raw);
  assert.throws(() => embeddedPython('dynamic.ts', [
    '// language=Python',
    'export const script = String.raw`print(${value})`;',
  ].join('\n')), /static.*String\.raw/);
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
  const directory = fs.mkdtempSync(path.join(root, 'build/.lint-fixture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'invalid.py'), 'print(undefined_name)\n');
  const result = lintRepository();
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /invalid.py/);
  assert.match(result.stdout, /F821/);
});

test('Husky hooks reject Bash-only syntax under the POSIX shell dialect', context => {
  const fixture = path.join(root, '.husky', `lint-fixture-${process.pid}`);
  fs.writeFileSync(fixture, '[[ -n "$HOME" ]]\n', { flag: 'wx' });
  context.after(() => fs.rmSync(fixture));
  const result = lintRepository();
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /SC3010/);
});

test('PowerShell syntax errors fail the repository command', context => {
  const directory = fs.mkdtempSync(path.join(root, 'build/.lint-fixture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'invalid.ps1'), 'if ($true) {\n');
  const result = lintRepository('powershell');
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout + result.stderr, /MissingEndCurlyBrace/);
});

test('virtual environment dependencies are not linted as project Python', context => {
  const directory = fs.mkdtempSync(path.join(root, 'build/.lint-fixture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dependency = path.join(directory, '.venv/lib/python3.12/site-packages/dependency.py');
  fs.mkdirSync(path.dirname(dependency), { recursive: true });
  fs.writeFileSync(dependency, 'print(undefined_dependency_name)\n');
  const result = lintRepository();
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.doesNotMatch(result.stdout, /dependency\.py/);
});

test('standalone shell scripts use their declared shebang dialect', context => {
  const directory = fs.mkdtempSync(path.join(root, 'build/.lint-fixture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, 'example.sh');
  fs.writeFileSync(script, '#!/bin/sh\n[[ -n "$HOME" ]]\n');
  const posix = lintRepository();
  assert.ifError(posix.error);
  assert.equal(posix.status, 1, posix.stderr);
  assert.match(posix.stdout, /SC3010/);

  fs.writeFileSync(script, '#!/usr/bin/env bash\n[[ -n "$HOME" ]]\n');
  const bash = lintRepository();
  assert.ifError(bash.error);
  assert.equal(bash.status, 0, bash.stderr + bash.stdout);
});

test('inline PowerShell accepts non-ASCII text without a synthetic encoding warning', context => {
  const workflow = path.join(root, '.github/workflows', `lint-fixture-${process.pid}.yml`);
  fs.writeFileSync(workflow, `
on: push
jobs:
  encoding:
    runs-on: windows-latest
    steps:
      - shell: pwsh
        run: Write-Output 'caf\u00e9'
`, { flag: 'wx' });
  context.after(() => fs.rmSync(workflow));
  const result = lintRepository('powershell');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('standalone PowerShell retains its original encoding diagnostics', context => {
  const directory = fs.mkdtempSync(path.join(root, 'build/.lint-fixture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, 'encoding.ps1');
  const source = "Write-Output 'caf\u00e9'\n";
  for (const [encoding, bytes, expectedStatus] of [
    ['UTF-8 without BOM', Buffer.from(source), 1],
    ['UTF-8 with BOM', Buffer.from(`\uFEFF${source}`), 0],
    ['UTF-16 with BOM', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(source, 'utf16le')]), 0],
  ] as const) {
    fs.writeFileSync(script, bytes);
    const result = lintRepository('powershell');
    assert.ifError(result.error);
    assert.equal(result.status, expectedStatus, `${encoding}\n${result.stderr}${result.stdout}`);
    if (expectedStatus === 1) assert.match(result.stdout, /PSUseBOMForUnicodeEncodedFile/);
  }
});

test('Python lint installation rejects replacement wheel bytes without contacting a registry', context => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'lint-wheel-integrity-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'ruff-0.17.4-py3-none-any.whl'), 'unreviewed wheel bytes');
  const result = spawnSync('python3', [
    '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir',
    '--no-index', '--find-links', directory, '--target', path.join(directory, 'installed'),
    '-r', path.join(root, '.config/lint/requirements.txt'),
  ], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DO NOT MATCH THE HASHES/);
  assert.equal(fs.existsSync(path.join(directory, 'installed', 'ruff')), false);
});

test('PowerShell analyzer installation rejects replacement archive bytes before extraction', context => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'lint-analyzer-integrity-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'analyzer.nupkg');
  const modules = path.join(directory, 'modules');
  fs.writeFileSync(archive, 'unreviewed analyzer bytes');
  const result = spawnSync('pwsh', [
    '-NoProfile', '-NonInteractive', '-File', path.join(root, '.config/lint/install-powershell.ps1'),
    '-ArchivePath', archive, '-ModuleRoot', modules,
  ], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256 mismatch/);
  assert.equal(fs.existsSync(modules), false);
});

test('raw Python templates reach Ruff and fail on undefined names', context => {
  const directory = fs.mkdtempSync(path.join(root, 'build/.lint-fixture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'template.ts'), [
    'throw new Error("must not execute");',
    '// language=Python',
    'export const script = String.raw`print(undefined_template_name)`;',
  ].join('\n'));
  const result = lintRepository();
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /template\.ts/);
  assert.match(result.stdout, /F821/);
});
