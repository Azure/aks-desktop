// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  installRequiredExtensions,
  resolveAzureCliTarget,
  verifyRequiredArtifact,
} from './azure-cli-config';

function createRoot(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-cli-config-'));
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({
      config: {
        externalTools: {
          python: {
            darwin: {
              x64: { url: 'darwin-x64', checksum: 'darwin-x64-sum' },
              arm64: { url: 'darwin-arm64', checksum: 'darwin-arm64-sum' },
            },
            linux: {
              x64: { url: 'linux-x64', checksum: 'linux-x64-sum' },
              arm64: { url: 'linux-arm64', checksum: 'linux-arm64-sum' },
            },
          },
          azureCli: {
            version: '2.89.0',
            extensions: ['resource-graph', 'connectedk8s'],
            win32: {
              x64: { url: 'win-x64', checksum: 'win-sum', runtimeArch: 'x64' },
              arm64: { url: 'win-x64', checksum: 'win-sum', runtimeArch: 'x64' },
            },
          },
        },
      },
    })
  );
  return rootDir;
}

test('selects native Python for Linux and macOS package targets', () => {
  const rootDir = createRoot();
  try {
    assert.equal(resolveAzureCliTarget(rootDir, 'darwin', 'arm64').python?.url, 'darwin-arm64');
    assert.equal(resolveAzureCliTarget(rootDir, 'linux', 'arm64').python?.url, 'linux-arm64');
    assert.equal(resolveAzureCliTarget(rootDir, 'linux', 'x64').python?.url, 'linux-x64');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('uses the supported x64 Azure CLI runtime for Windows ARM packages', () => {
  const rootDir = createRoot();
  try {
    const target = resolveAzureCliTarget(rootDir, 'win32', 'arm64');
    assert.equal(target.windowsPackage?.url, 'win-x64');
    assert.equal(target.windowsPackage?.runtimeArch, 'x64');
    assert.deepEqual(target.extensions, ['resource-graph', 'connectedk8s']);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('rejects targets without a verified runtime', () => {
  const rootDir = createRoot();
  try {
    assert.throws(() => resolveAzureCliTarget(rootDir, 'linux', 'armv7l'));
    assert.throws(() => resolveAzureCliTarget(rootDir, 'aix', 'x64'));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('rejects an artifact whose checksum does not match', async () => {
  await assert.doesNotReject(verifyRequiredArtifact(Promise.resolve(true), 'Azure CLI'));
  await assert.rejects(
    verifyRequiredArtifact(Promise.resolve(false), 'Azure CLI'),
    /Azure CLI checksum verification failed/
  );
});

test('propagates required extension installation failures', () => {
  const installed: string[] = [];
  assert.throws(
    () =>
      installRequiredExtensions(['resource-graph', 'connectedk8s'], extension => {
        installed.push(extension);
        if (extension === 'connectedk8s') {
          throw new Error('extension failed');
        }
      }),
    /extension failed/
  );
  assert.deepEqual(installed, ['resource-graph', 'connectedk8s']);
});
