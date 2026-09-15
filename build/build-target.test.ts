// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  parseTargetArgs,
  readBuildTarget,
  removeRetiredAksMcpArtifacts,
  resolveTargetArch,
  writeBuildTarget,
} from './build-target';

test('parseTargetArgs reads packaging target arguments', () => {
  assert.deepEqual(parseTargetArgs(['--platform=win32', '--arch=arm64', '--other=1']), {
    platform: 'win32',
    arch: 'arm64',
  });
  assert.deepEqual(parseTargetArgs([]), { platform: undefined, arch: undefined });
});

test('resolveTargetArch prefers explicit and npm target architectures', () => {
  const originalTargetArch = process.env.npm_config_target_arch;
  const originalArch = process.env.npm_config_arch;
  try {
    process.env.npm_config_target_arch = 'arm64';
    process.env.npm_config_arch = 'x64';
    assert.equal(resolveTargetArch('armv7l'), 'armv7l');
    assert.equal(resolveTargetArch(), 'arm64');

    delete process.env.npm_config_target_arch;
    assert.equal(resolveTargetArch(), 'x64');

    delete process.env.npm_config_arch;
    assert.equal(resolveTargetArch(), process.arch);
  } finally {
    if (originalTargetArch === undefined) delete process.env.npm_config_target_arch;
    else process.env.npm_config_target_arch = originalTargetArch;
    if (originalArch === undefined) delete process.env.npm_config_arch;
    else process.env.npm_config_arch = originalArch;
  }
});

test('writeBuildTarget persists the target used by later build steps', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-target-'));
  try {
    assert.equal(readBuildTarget(rootDir), undefined);
    writeBuildTarget(rootDir, { platform: 'linux', arch: 'arm64' });
    assert.deepEqual(readBuildTarget(rootDir), { platform: 'linux', arch: 'arm64' });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('removeRetiredAksMcpArtifacts removes stale binaries and target metadata', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-aks-mcp-'));
  const resourcesDir = path.join(rootDir, 'headlamp', 'app', 'resources');
  const binDir = path.join(resourcesDir, 'external-tools', 'bin');
  const retiredPaths = [
    path.join(binDir, 'aks-mcp'),
    path.join(binDir, 'aks-mcp.exe'),
    path.join(resourcesDir, '.aks-mcp-target.json'),
  ];
  const retainedPath = path.join(binDir, 'az');
  try {
    fs.mkdirSync(binDir, { recursive: true });
    for (const filePath of [...retiredPaths, retainedPath]) {
      fs.writeFileSync(filePath, 'test');
    }

    removeRetiredAksMcpArtifacts(rootDir);

    for (const filePath of retiredPaths) {
      assert.equal(fs.existsSync(filePath), false);
    }
    assert.equal(fs.existsSync(retainedPath), true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});