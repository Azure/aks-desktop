// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';
import {
  azureCliTargetDirHasContent,
  generateWindowsAzWrapperScript,
  isAzureCliStagedForTarget,
  readStagedAzureCliTarget,
  resolveAzureCliBundleArch,
  resolveAzureCliTarget,
  WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME,
  WINDOWS_AZ_CLI_ORIGINAL_FILENAME,
  writeStagedAzureCliTarget,
} from './az-cli-config';

const roots: string[] = [];
const config = {
  python: {
    linux: {
      x64: { url: 'https://example/linux-x64.tgz', checksum: 'linux-x64' },
      arm64: { url: 'https://example/linux-arm64.tgz', checksum: 'linux-arm64' },
    },
    darwin: {
      x64: { url: 'https://example/mac-x64.tgz', checksum: 'mac-x64' },
      arm64: { url: 'https://example/mac-arm64.tgz', checksum: 'mac-arm64' },
    },
  },
  azureCli: {
    version: '2.78.0',
    extensions: ['aks-preview'],
    win32: {
      x64: { url: 'https://example/az-x64.zip', checksum: 'win-x64' },
    },
  },
};

function createRoot(externalTools: unknown = config): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'az-cli-config-'));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ config: { externalTools } })
  );
  return root;
}

afterEach(() => {
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

test('selects native Python for Linux targets and x64 Python for macOS', () => {
  const root = createRoot();
  const linux = resolveAzureCliTarget(root, 'linux', 'arm64');
  const mac = resolveAzureCliTarget(root, 'darwin', 'arm64');

  assert.equal(linux.bundleArch, 'arm64');
  assert.equal(linux.python?.checksum, 'linux-arm64');
  assert.equal(mac.bundleArch, 'x64');
  assert.equal(mac.python?.checksum, 'mac-x64');
});

test('uses the official x64 Azure CLI under Windows ARM64 emulation', () => {
  const root = createRoot();
  const target = resolveAzureCliTarget(root, 'win32', 'arm64');

  assert.equal(resolveAzureCliBundleArch('win32', 'arm64'), 'x64');
  assert.equal(target.bundleArch, 'x64');
  assert.equal(target.archive?.url, 'https://example/az-x64.zip');
});

test('rejects unsupported targets and unpinned downloads', () => {
  const root = createRoot();
  assert.throws(() => resolveAzureCliTarget(root, 'linux', 'armv7l'), /Unsupported architecture/);
  assert.throws(() => resolveAzureCliTarget(root, 'aix', 'x64'), /Unsupported platform/);
  assert.throws(
    () => resolveAzureCliTarget(createRoot({ azureCli: { version: 'latest' } }), 'win32', 'x64'),
    /must be pinned/
  );
});

test('only accepts a complete marker and executable for the current target', () => {
  const root = createRoot();
  const target = resolveAzureCliTarget(root, 'linux', 'x64');
  fs.mkdirSync(path.dirname(target.executablePath), { recursive: true });
  fs.writeFileSync(target.executablePath, '#!/bin/sh\n');
  fs.chmodSync(target.executablePath, 0o755);

  assert.equal(isAzureCliStagedForTarget(root, target), false);
  writeStagedAzureCliTarget(root, target);
  assert.deepEqual(readStagedAzureCliTarget(root), {
    platform: 'linux',
    arch: 'x64',
    bundleArch: 'x64',
    fingerprint: target.fingerprint,
  });
  assert.equal(isAzureCliStagedForTarget(root, target), true);

  const otherTarget = resolveAzureCliTarget(root, 'linux', 'arm64');
  assert.equal(isAzureCliStagedForTarget(root, otherTarget), false);
});

test('rejects a Unix wrapper whose executable bit was stripped', () => {
  const root = createRoot();
  const target = resolveAzureCliTarget(root, 'linux', 'x64');
  fs.mkdirSync(path.dirname(target.executablePath), { recursive: true });
  fs.writeFileSync(target.executablePath, '#!/bin/sh\n', { mode: 0o644 });
  writeStagedAzureCliTarget(root, target);

  assert.equal(isAzureCliStagedForTarget(root, target), false);
});

test('detects content left by an interrupted install', () => {
  const root = createRoot();
  const target = resolveAzureCliTarget(root, 'linux', 'x64');
  assert.equal(azureCliTargetDirHasContent(target), false);

  fs.mkdirSync(path.join(target.targetDir, 'cliextensions', 'old-extension'), {
    recursive: true,
  });
  assert.equal(azureCliTargetDirHasContent(target), true);
});

test('Windows wrapper isolates extensions and delegates to the original CLI', () => {
  const script = generateWindowsAzWrapperScript();

  assert.match(
    script,
    new RegExp(`set "AZURE_EXTENSION_DIR=%~dp0\\.\\.\\\\${WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME}"`)
  );
  assert.match(script, new RegExp(`call "%~dp0${WINDOWS_AZ_CLI_ORIGINAL_FILENAME}" %\\*`));
  assert.match(script, /exit \/b %ERRORLEVEL%/);
  assert.doesNotMatch(script, /[A-Za-z]:\\/);
});
