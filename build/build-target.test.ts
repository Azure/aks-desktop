// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  parseTargetArgs,
  readStagedTarget,
  resolveTargetArch,
  writeStagedTarget,
} from './build-target';

const tempDirs: string[] = [];
const originalEnv = {
  npm_config_target_arch: process.env.npm_config_target_arch,
  npm_config_arch: process.env.npm_config_arch,
};

function restoreEnvVar(name: 'npm_config_target_arch' | 'npm_config_arch') {
  const value = originalEnv[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
  restoreEnvVar('npm_config_target_arch');
  restoreEnvVar('npm_config_arch');
});

function createRoot(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-target-'));
  tempDirs.push(rootDir);
  return rootDir;
}

test('parses platform and arch arguments and ignores unrelated ones', () => {
  assert.deepEqual(parseTargetArgs(['--platform=win32', '--arch=arm64', '--other=1']), {
    platform: 'win32',
    arch: 'arm64',
  });
  assert.deepEqual(parseTargetArgs([]), { platform: undefined, arch: undefined });
});

test('prefers an explicit arch over the npm config vars and the host arch', () => {
  process.env.npm_config_target_arch = 'arm64';
  process.env.npm_config_arch = 'x64';
  assert.equal(resolveTargetArch('armv7l'), 'armv7l');
});

test('prefers npm_config_target_arch over npm_config_arch', () => {
  process.env.npm_config_target_arch = 'arm64';
  process.env.npm_config_arch = 'x64';
  assert.equal(resolveTargetArch(), 'arm64');
});

test('falls back to npm_config_arch and then to the host arch', () => {
  process.env.npm_config_arch = 'arm64';
  assert.equal(resolveTargetArch(), 'arm64');

  delete process.env.npm_config_arch;
  assert.equal(resolveTargetArch(), process.arch);
});

test('round trips the staged target marker', () => {
  const rootDir = createRoot();
  assert.equal(readStagedTarget(rootDir), undefined);

  writeStagedTarget(rootDir, { platform: 'win32', arch: 'arm64' });
  assert.deepEqual(readStagedTarget(rootDir), { platform: 'win32', arch: 'arm64' });
});

test('treats a corrupt staged target marker as missing', () => {
  const rootDir = createRoot();
  const markerPath = path.join(rootDir, 'headlamp', 'app', 'resources', '.build-target.json');
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, 'not json');

  assert.equal(readStagedTarget(rootDir), undefined);
});
