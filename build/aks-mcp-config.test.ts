// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  aksMcpBinaryName,
  aksMcpBinaryPath,
  ensureExecutable,
  isExecutable,
  isSupportedAksMcpArch,
  matchesChecksum,
  parseTargetArgs,
  readStagedTarget,
  resolveAksMcpTarget,
  resolveTargetArch,
  writeStagedTarget,
} from './aks-mcp-config';

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

const AKS_MCP_CONFIG = {
  version: 'v1.2.3',
  darwin: { arm64: { checksum: 'darwin-arm64-sum' }, amd64: { checksum: 'darwin-amd64-sum' } },
  linux: { arm64: { checksum: 'linux-arm64-sum' }, amd64: { checksum: 'linux-amd64-sum' } },
  win32: { arm64: { checksum: 'win-arm64-sum' }, amd64: { checksum: 'win-amd64-sum' } },
};

function createRoot(aksMcp: unknown = AKS_MCP_CONFIG): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-mcp-config-'));
  tempDirs.push(rootDir);
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ config: { externalTools: { aksMcp } } })
  );
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

test('reports which architectures have a release asset', () => {
  assert.equal(isSupportedAksMcpArch('x64'), true);
  assert.equal(isSupportedAksMcpArch('arm64'), true);
  assert.equal(isSupportedAksMcpArch('armv7l'), false);
  assert.equal(isSupportedAksMcpArch('ia32'), false);
});

test('uses the executable suffix only on Windows', () => {
  assert.equal(aksMcpBinaryName('win32'), 'aks-mcp.exe');
  assert.equal(aksMcpBinaryName('linux'), 'aks-mcp');
  assert.equal(
    aksMcpBinaryPath('/repo', 'darwin'),
    path.join('/repo', 'headlamp', 'app', 'resources', 'external-tools', 'bin', 'aks-mcp')
  );
});

test('maps node platform and arch onto the published asset names', () => {
  const rootDir = createRoot();

  assert.equal(
    resolveAksMcpTarget(rootDir, 'linux', 'x64').downloadUrl,
    'https://github.com/Azure/aks-mcp/releases/download/v1.2.3/aks-mcp-linux-amd64'
  );
  assert.equal(
    resolveAksMcpTarget(rootDir, 'darwin', 'arm64').downloadUrl,
    'https://github.com/Azure/aks-mcp/releases/download/v1.2.3/aks-mcp-darwin-amd64'
  );
  assert.equal(
    resolveAksMcpTarget(rootDir, 'win32', 'arm64').downloadUrl,
    'https://github.com/Azure/aks-mcp/releases/download/v1.2.3/aks-mcp-windows-arm64.exe'
  );
});

test('stages the notarizable amd64 asset for each mac target', () => {
  const rootDir = createRoot();

  assert.equal(
    resolveAksMcpTarget(rootDir, 'darwin', 'arm64').expectedChecksum,
    'darwin-amd64-sum'
  );
  assert.equal(resolveAksMcpTarget(rootDir, 'darwin', 'x64').expectedChecksum, 'darwin-amd64-sum');
});

test('selects the checksum for the requested architecture', () => {
  const rootDir = createRoot();

  assert.equal(resolveAksMcpTarget(rootDir, 'linux', 'x64').expectedChecksum, 'linux-amd64-sum');
  assert.equal(resolveAksMcpTarget(rootDir, 'linux', 'arm64').expectedChecksum, 'linux-arm64-sum');
  assert.equal(resolveAksMcpTarget(rootDir, 'win32', 'x64').expectedChecksum, 'win-amd64-sum');
});

test('resolves the target arch from the environment when none is passed', () => {
  const rootDir = createRoot();
  process.env.npm_config_target_arch = 'arm64';

  const target = resolveAksMcpTarget(rootDir, 'linux');

  assert.equal(target.arch, 'arm64');
  assert.equal(target.expectedChecksum, 'linux-arm64-sum');
});

test('rejects platforms and architectures without a release asset', () => {
  const rootDir = createRoot();

  assert.throws(() => resolveAksMcpTarget(rootDir, 'aix', 'x64'), /Unsupported platform/);
  assert.throws(() => resolveAksMcpTarget(rootDir, 'linux', 'armv7l'), /Unsupported architecture/);
});

test('rejects an unpinned version and a missing checksum', () => {
  assert.throws(
    () => resolveAksMcpTarget(createRoot({ ...AKS_MCP_CONFIG, version: 'latest' }), 'linux', 'x64'),
    /must be pinned/
  );
  assert.throws(
    () => resolveAksMcpTarget(createRoot({ version: 'v1.2.3' }), 'linux', 'x64'),
    /No sha256 checksum configured/
  );
});

test('round-trips the staged target and tolerates a missing or corrupt marker', () => {
  const rootDir = createRoot();

  assert.equal(readStagedTarget(rootDir), undefined);

  writeStagedTarget(rootDir, { platform: 'win32', arch: 'arm64', checksum: 'win-arm64-sum' });
  assert.deepEqual(readStagedTarget(rootDir), {
    platform: 'win32',
    arch: 'arm64',
    checksum: 'win-arm64-sum',
  });

  fs.writeFileSync(
    path.join(rootDir, 'headlamp', 'app', 'resources', '.aks-mcp-target.json'),
    'not json'
  );
  assert.equal(readStagedTarget(rootDir), undefined);
});

test('matches a checksum only for an existing file with the same digest', () => {
  const rootDir = createRoot();
  const filePath = path.join(rootDir, 'binary');
  fs.writeFileSync(filePath, 'aks-mcp');
  const digest = createHash('sha256').update('aks-mcp').digest('hex');

  assert.equal(matchesChecksum(filePath, digest), true);
  assert.equal(matchesChecksum(filePath, 'not-the-digest'), false);
  assert.equal(matchesChecksum(path.join(rootDir, 'missing'), digest), false);
});

test('treats a file without the executable bit as not executable', {
  skip: process.platform === 'win32' ? 'file modes are not enforced on Windows' : false,
}, () => {
  const rootDir = createRoot();
  const filePath = path.join(rootDir, 'binary');
  fs.writeFileSync(filePath, 'aks-mcp', { mode: 0o644 });

  assert.equal(isExecutable(filePath, 'linux'), false);
  // Windows packages have no executable bit to check.
  assert.equal(isExecutable(filePath, 'win32'), true);
  assert.equal(isExecutable(path.join(rootDir, 'missing'), 'linux'), false);
});

test('restores an executable bit dropped by a cache or archive', {
  skip: process.platform === 'win32' ? 'file modes are not enforced on Windows' : false,
}, () => {
  const rootDir = createRoot();
  const filePath = path.join(rootDir, 'binary');
  fs.writeFileSync(filePath, 'aks-mcp', { mode: 0o644 });

  ensureExecutable(filePath, 'linux');

  assert.equal(isExecutable(filePath, 'linux'), true);
});
