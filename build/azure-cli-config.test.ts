// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  azureCliCacheIdentity,
  azureCliCacheKey,
  azureCliExtensionsToInstall,
  azureCliExtensionsToRemove,
  azureCliVersionDataMatchesTarget,
  installRequiredExtensions,
  resolveAzureCliTarget,
  verifyRequiredArtifact,
  windowsZipExtraction,
} from './azure-cli-config';
import { generateUnixAzWrapperScript } from './az-cli-config';

test('passes Windows ZIP paths as literal environment values', () => {
  const archive = "C:\\O'Brien [build] & tools\\input.zip";
  const destination = "C:\\O'Brien [build] & tools\\out";
  const invocation = windowsZipExtraction(archive, destination, { PATH: 'existing' });
  assert.equal(invocation.command, 'powershell.exe');
  assert.match(invocation.args.at(-1)!, /Expand-Archive -LiteralPath \$env:AKS_ZIP_ARCHIVE/);
  assert.match(invocation.args.at(-1)!, /\$ErrorActionPreference = 'Stop'/);
  assert.ok(invocation.args.every(argument =>
    !argument.includes(archive) && !argument.includes(destination)
  ));
  assert.deepEqual(invocation.env, {
    PATH: 'existing',
    AKS_ZIP_ARCHIVE: archive,
    AKS_ZIP_DESTINATION: destination,
  });
});

test('extracts Windows ZIPs under paths containing quotes and wildcards', {
  skip: process.platform !== 'win32',
}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aks-O'Brien [build] & tools-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'input');
  fs.mkdirSync(input);
  const payload = path.join(input, 'payload.txt');
  fs.writeFileSync(payload, 'zip contents');
  const archive = path.join(root, 'input.zip');
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:AKS_ZIP_INPUT, $env:AKS_ZIP_ARCHIVE)",
  ], { env: { ...process.env, AKS_ZIP_INPUT: input, AKS_ZIP_ARCHIVE: archive } });
  const extraction = windowsZipExtraction(archive, path.join(root, 'out'));
  execFileSync(extraction.command, extraction.args, { env: extraction.env });
  assert.equal(fs.readFileSync(path.join(root, 'out', 'payload.txt'), 'utf8'), 'zip contents');
});

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
            version: '2.90.0',
            extensions: ['resource-graph', 'connectedk8s'],
            extensionVersions: {
              'resource-graph': '2.1.1',
              connectedk8s: '1.11.3',
            },
            darwin: {
              x64: { url: 'mac-x64', checksum: 'mac-x64-sum' },
              arm64: { url: 'mac-arm64', checksum: 'mac-arm64-sum' },
            },
            linux: {
              x64: { url: 'linux-cli-x64', checksum: 'linux-cli-x64-sum' },
              arm64: { url: 'linux-cli-arm64', checksum: 'linux-cli-arm64-sum' },
            },
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
    const darwin = resolveAzureCliTarget(rootDir, 'darwin', 'arm64');
    assert.equal(darwin.python?.url, 'darwin-arm64');
    assert.equal(darwin.cliPackage?.url, 'mac-arm64');
    const linuxArm = resolveAzureCliTarget(rootDir, 'linux', 'arm64');
    assert.equal(linuxArm.python?.url, 'linux-arm64');
    assert.equal(linuxArm.cliPackage?.url, 'linux-cli-arm64');
    assert.equal(resolveAzureCliTarget(rootDir, 'linux', 'x64').python?.url, 'linux-x64');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('uses the supported x64 Azure CLI runtime for Windows ARM packages', () => {
  const rootDir = createRoot();
  try {
    const target = resolveAzureCliTarget(rootDir, 'win32', 'arm64');
    assert.equal(target.cliPackage?.url, 'win-x64');
    assert.equal(target.cliPackage?.runtimeArch, 'x64');
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

test('includes sorted extensions in the staged cache identity', () => {
  const target = {
    platform: 'linux',
    arch: 'arm64',
    version: '2.90.0',
    extensions: ['resource-graph', 'connectedk8s'],
    extensionVersions: {
      'resource-graph': '2.1.1',
      connectedk8s: '1.11.3',
    },
    python: { url: 'python', checksum: 'python-sum' },
    cliPackage: { url: 'cli', checksum: 'cli-sum' },
  };
  const identity = azureCliCacheIdentity(target);
  assert.deepEqual(identity.extensions, ['connectedk8s', 'resource-graph']);
  assert.equal(identity.pythonChecksum, 'python-sum');
  assert.equal(identity.packageChecksum, 'cli-sum');
  assert.deepEqual(identity.extensionVersions, {
    connectedk8s: '1.11.3',
    'resource-graph': '2.1.1',
  });
  assert.match(azureCliCacheKey(target), /^[0-9a-f]{64}$/);
  assert.notEqual(
    azureCliCacheKey(target),
    azureCliCacheKey({
      ...target,
      extensionVersions: { ...target.extensionVersions, connectedk8s: '1.11.4' },
    })
  );
  assert.equal(
    azureCliVersionDataMatchesTarget(target, {
      'azure-cli': '2.90.0',
      extensions: { connectedk8s: '1.11.3', 'resource-graph': '2.1.1' },
    }),
    true
  );
  assert.equal(
    azureCliVersionDataMatchesTarget(target, {
      'azure-cli': '2.90.0',
      extensions: { connectedk8s: '1.11.2', 'resource-graph': '2.1.1' },
    }),
    false
  );
  assert.deepEqual(
    azureCliExtensionsToInstall(target, {
      connectedk8s: '1.11.2',
      'resource-graph': '2.1.1',
    }),
    ['connectedk8s']
  );
  assert.deepEqual(
    azureCliExtensionsToRemove(target, {
      connectedk8s: '1.11.3',
      'resource-graph': '2.1.1',
      'aks-preview': '19.0.0',
    }),
    ['aks-preview']
  );
});

test('generates a relocatable self-contained Unix wrapper', () => {
  const wrapper = generateUnixAzWrapperScript();
  assert.match(wrapper, /AZ_PYTHON="\$CLI_DIR\/python\/bin\/python3"/);
  assert.doesNotMatch(wrapper, /\$CLI_DIR\/bin\/python3/);
  assert.match(wrapper, /AZURE_EXTENSION_DIR="\$CLI_DIR\/cliextensions"/);
  assert.match(wrapper, /exec "\$CLI_DIR\/libexec\/bin\/az" "\$@"/);
  assert.doesNotMatch(wrapper, /\/Users\//);
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
