// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  productPluginCommandPolicies,
  type BuildManifest,
} from '../../node_modules/@headlamp-k8s/headlamp-source/source/app/scripts/build-manifest';
import {
  applyCommandEnvironment,
  createProductCommandCapabilities,
  handleRunCommand,
  verifyPluginCommandPolicies,
  type PluginCommandRegistration,
} from '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/runCmd';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  environment: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  dialog: vi.fn(),
  forbidden: vi.fn(() => {
    throw new Error(
      'This mocked integration test must not launch or persist real application state'
    );
  }),
}));

vi.mock('cross-spawn', () => ({ default: mocks.spawn }));
vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: { showMessageBoxSync: mocks.dialog },
  app: { getPath: mocks.forbidden },
  ipcMain: { on: mocks.forbidden, handle: mocks.forbidden },
  safeStorage: {},
}));
vi.mock('../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/main', () => ({
  getShellEnvironment: mocks.environment,
}));
vi.mock('../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/settings', () => ({
  loadSettings: mocks.settings,
  saveSettings: mocks.saveSettings,
  SETTINGS_PATH: 'in-memory-local-plugin-test',
}));
vi.mock(
  '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/i18next.config',
  () => ({ default: { t: (message: string) => message } })
);
vi.mock(
  '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/plugin-management',
  () => ({
    defaultPluginsDir: mocks.forbidden,
    defaultUserPluginsDir: mocks.forbidden,
    PREPARED_PLUGIN_SCRIPTS_PATH: 'unused-in-local-plugin-test',
    preparePluginExecutable: mocks.forbidden,
    preparePluginScript: mocks.forbidden,
    removePreparedPluginExecutable: mocks.forbidden,
    removePreparedPluginScript: mocks.forbidden,
    verifyPluginInstallationIntegrity: mocks.forbidden,
  })
);

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const {
  createProductTemplate,
} = require('../../packages/headlamp-source/src/lib/product-manifest.ts');
const project = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const trustedUrl = 'http://localhost:15466';
const identity = {
  source: 'development',
  packageName: '@headlamp-k8s/developer-cluster',
  bundleName: 'developer-cluster',
};
const guest = ['--output', 'json'];
const versions = ['cluster', 'get-versions', ...guest];
const configuration = ['--name', 'demo', '--kubernetes-version', 'v1.36.5'];
let temporaryRoot: string;
let resources: string;
let executable: string;
let manifest: BuildManifest;
let registration: PluginCommandRegistration;
let roots: Record<'development' | 'user' | 'shipped', string>;
let consent: Record<string, boolean>;

function consentKey(args: string[]) {
  return `run-command-consent:v2:${JSON.stringify([identity, 'aks-devctl', args])}`;
}

beforeEach(() => {
  expect(process.platform, 'Use native Windows Node for this host integration').toBe('win32');
  expect(process.arch).toBe('x64');
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'developer-cluster-plugin-test-')));
  resources = path.join(temporaryRoot, 'resources');
  roots = {
    development: path.join(temporaryRoot, 'plugins'),
    user: path.join(temporaryRoot, 'user-plugins'),
    shipped: path.join(resources, '.plugins'),
  };
  for (const directory of Object.values(roots)) fs.mkdirSync(directory, { recursive: true });
  const bundle = path.join(roots.development, 'developer-cluster');
  fs.mkdirSync(path.join(bundle, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'package.json'),
    JSON.stringify({ name: identity.packageName })
  );
  const source = '/* synthetic standalone plugin fixture */';
  fs.writeFileSync(path.join(bundle, 'main.js'), source);
  executable = path.join(bundle, 'bin', 'aks-devctl.exe');
  fs.writeFileSync(executable, 'Not an executable: all process creation is mocked.');
  const environmentDirectory = path.join(resources, 'external-tools');
  fs.mkdirSync(environmentDirectory);
  fs.copyFileSync(
    path.join(root, 'build/aks-tool-environment.cjs'),
    path.join(environmentDirectory, 'aks-tool-environment.cjs')
  );
  manifest = { ...createProductTemplate(project, 'win32', 'x64'), 'external-tools': [] };
  registration = {
    ...identity,
    type: 'development',
    path: 'plugins/developer-cluster',
    sourceDigest: crypto.createHash('sha256').update(source).digest('hex'),
  };
  consent = Object.fromEntries(
    productPluginCommandPolicies(manifest, 'production')
      .filter(policy => policy.packageName === identity.packageName)
      .flatMap(policy => policy.grants.map(grant => [consentKey(grant.args), true]))
  );
  mocks.settings.mockImplementation(() => ({ confirmedCommands: consent }));
  mocks.dialog.mockReturnValue(1);
  mocks.environment.mockImplementation(() =>
    applyCommandEnvironment(
      { PATH: path.join(temporaryRoot, 'untrusted-PATH'), SystemRoot: process.env.SystemRoot },
      manifest,
      resources
    )
  );
  mocks.spawn.mockImplementation(() =>
    Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
  );
});

afterEach(() => {
  expect(mocks.forbidden).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  fs.rmSync(temporaryRoot, { recursive: true });
});

async function capabilities(candidate = registration) {
  const policies = productPluginCommandPolicies(manifest, 'production');
  const verified = await verifyPluginCommandPolicies(policies, [candidate], roots);
  return createProductCommandCapabilities([candidate], verified, 7);
}

async function invoke(
  args: string[],
  options: Record<string, unknown> = {},
  url = trustedUrl,
  revoked = false
) {
  const authorization = await capabilities();
  expect(authorization.capabilities).toHaveLength(1);
  expect(authorization.capabilities[0].clusterRegistrationProviders).toEqual([]);
  if (revoked) authorization.capabilityRegistry.clear();
  const send = vi.fn();
  const sender = { id: 7, mainFrame: { url }, send };
  await handleRunCommand(
    { sender, senderFrame: sender.mainFrame } as Parameters<typeof handleRunCommand>[0],
    {
      id: 'mock-operation',
      command: 'aks-devctl',
      args,
      options,
      permissionSecrets: {},
      capability: authorization.capabilities[0].capability,
    },
    { webContents: sender } as Parameters<typeof handleRunCommand>[2],
    {},
    authorization.capabilityRegistry,
    trustedUrl,
    roots
  );
  return send;
}

it('uses the exact developer binary and shell-free spawn', async () => {
  const args = versions;
  const send = await invoke(args);
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
    executable,
    args,
    expect.objectContaining({ shell: false })
  );
  const child = mocks.spawn.mock.results[0].value as EventEmitter;
  child.emit('close', 0);
  expect(send).toHaveBeenCalledWith('command-exit', 'mock-operation', 0);
  expect(mocks.dialog).not.toHaveBeenCalled();
});

it.each(['sourceDigest', 'packageName', 'bundleName', 'source'] as const)(
  'refuses mismatched plugin %s before issuing a capability',
  async field => {
    const candidate = { ...registration, [field]: field === 'source' ? 'user' : 'mismatch' };
    const result = await capabilities(candidate);
    expect(result.capabilities).toHaveLength(0);
    expect(mocks.spawn).not.toHaveBeenCalled();
  }
);

it.each([
  ['linux', 'x64'],
  ['win32', 'arm64'],
])('omits the whole plugin policy for unsupported %s/%s', (platform, arch) => {
  const other = createProductTemplate(project, platform, arch);
  expect(productPluginCommandPolicies(other, 'production')).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ packageName: identity.packageName })])
  );
});

it('does not inherit command authority in the managed user inventory', async () => {
  fs.cpSync(path.dirname(path.dirname(executable)), path.join(roots.user, 'developer-cluster'), {
    recursive: true,
  });
  const result = await capabilities({
    ...registration,
    source: 'user',
    type: 'user',
    path: 'user-plugins/developer-cluster',
  });
  expect(result.capabilities).toHaveLength(0);
});

it('never falls back to PATH when the declared binary is absent', async () => {
  fs.unlinkSync(executable);
  const send = await invoke(versions);
  expect(send).toHaveBeenCalledWith('command-exit', 'mock-operation', -2);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it.each([
  versions,
  ['cluster', 'create', ...guest, '--kubernetes-distribution', 'K8s', ...configuration],
  ['cluster', 'delete', ...guest, '--name', 'demo', '--yes'],
])('runs preapproved %j without the native dialog or a saved consent', async (...args) => {
  consent = {};
  await invoke(args);
  expect(mocks.dialog).not.toHaveBeenCalled();
  expect(mocks.saveSettings).not.toHaveBeenCalled();
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
    executable,
    args,
    expect.objectContaining({ shell: false })
  );
});

it('honors saved denial even when other operations have approval', async () => {
  consent[consentKey(versions)] = false;
  const send = await invoke(versions);
  expect(send).toHaveBeenCalledWith('command-exit', 'mock-operation', -3);
  expect(mocks.dialog).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it.each([
  [...versions, '--unexpected'],
  ['cluster', 'get-versions', '--json'],
  ['cluster', 'show', ...guest, '--name', 'demo'],
  ['cluster', 'show', '--json', '--provider', 'wsl', '--distro', 'Ubuntu-24.04'],
  ['cluster', 'create', '--json', '--kubernetes-distribution', 'K3s', ...configuration],
  ['cluster', 'delete', '--name', 'demo', '--yes'],
])('rejects arguments outside the product grant: %j', async (...args) => {
  const send = await invoke(args);
  expect(send).toHaveBeenCalledWith('command-exit', 'mock-operation', -2);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it.each([
  ['cluster', 'create', ...guest, '--kubernetes-distribution', 'K8s', ...configuration],
  ['cluster', 'create', ...guest, '--kubernetes-distribution', 'K3s', ...configuration],
  [
    'cluster',
    'create',
    ...guest,
    '--kubernetes-distribution',
    'K8s',
    ...configuration,
    '--enable-gpu',
  ],
  ['cluster', 'delete', ...guest, '--name', 'demo', '--yes'],
])(
  'runs the plugin create and delete shapes through the variable-argument grants: %j',
  async (...args) => {
    await invoke(args);
    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
      executable,
      args,
      expect.objectContaining({ shell: false })
    );
  }
);

it('rejects renderer spawn overrides, revoked capabilities, and untrusted documents', async () => {
  for (const [options, url, revoked] of [
    [{ env: { PATH: 'untrusted' } }, trustedUrl, false],
    [{}, trustedUrl, true],
    [{}, 'https://untrusted.invalid', false],
  ] as const) {
    await invoke(versions, options, url, revoked);
  }
  expect(mocks.environment).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});
