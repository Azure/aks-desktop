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
import { resolveClusterRegistrationRuntime } from '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/cluster-registration';
import {
  applyCommandEnvironment,
  createProductCommandCapabilities,
  handleRunCommand,
  resolveCommandExecutable,
  verifyPluginCommandPolicies,
  type PluginCommandRegistration,
} from '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/runCmd';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  environment: vi.fn(),
  executable: vi.fn(),
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
  getProductCommandExecutable: mocks.executable,
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
  packageName: '@headlamp-k8s/aksedge',
  bundleName: 'aksedge',
};
const prefix = [
  '--json',
  '--driver',
  'wsl',
  '--distro',
  'Ubuntu-24.04',
  '--distribution',
  'K8s',
  '--cni',
  'cilium',
  '--reach',
  'shared',
  '--wsl-stable-ip',
  'off',
];
const configuration = ['--name', 'demo', '--k8s-version', '1.36.1-20260701'];
let temporaryRoot: string;
let privateDirectory: string | undefined;
let resources: string;
let executable: string;
let manifest: BuildManifest;
let registration: PluginCommandRegistration;
let roots: Record<'development' | 'user' | 'shipped', string>;
let consent: Record<string, boolean>;

function consentKey(args: string[]) {
  return `run-command-consent:v2:${JSON.stringify([identity, 'aksedge', args])}`;
}

beforeEach(() => {
  expect(process.platform, 'Use native Windows Node for this host integration').toBe('win32');
  expect(process.arch).toBe('x64');
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aksedge-plugin-test-')));
  privateDirectory = undefined;
  resources = path.join(temporaryRoot, 'resources');
  roots = {
    development: path.join(temporaryRoot, 'plugins'),
    user: path.join(temporaryRoot, 'user-plugins'),
    shipped: path.join(resources, '.plugins'),
  };
  for (const directory of Object.values(roots)) fs.mkdirSync(directory, { recursive: true });
  const bundle = path.join(roots.development, 'aksedge');
  fs.mkdirSync(path.join(bundle, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'package.json'),
    JSON.stringify({ name: identity.packageName })
  );
  const source = '/* synthetic standalone plugin fixture */';
  fs.writeFileSync(path.join(bundle, 'main.js'), source);
  executable = path.join(bundle, 'bin', 'aksedge.exe');
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
    path: 'plugins/aksedge',
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
  mocks.executable.mockImplementation((command: string, args: string[], validateOnly = false) =>
    resolveCommandExecutable(command, manifest, resources, args, validateOnly)
  );
  mocks.spawn.mockImplementation(() =>
    Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
  );
});

afterEach(() => {
  expect(mocks.forbidden).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  if (privateDirectory) fs.rmSync(privateDirectory, { recursive: true });
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
  expect(authorization.capabilities[0].clusterRegistrationProviders).toEqual(['aksedge-local']);
  if (revoked) authorization.capabilityRegistry.clear();
  const send = vi.fn();
  const sender = { id: 7, mainFrame: { url }, send };
  await handleRunCommand(
    { sender, senderFrame: sender.mainFrame } as Parameters<typeof handleRunCommand>[0],
    {
      id: 'mock-operation',
      command: 'aksedge',
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

it('uses the exact developer binary, empty provider tools, native validation, and shell-free spawn', async () => {
  const policies = productPluginCommandPolicies(manifest, 'production');
  const provider = policies.find(policy => policy.packageName === identity.packageName)
    ?.clusterRegistrationProviders?.[0];
  expect(provider).toEqual({ id: 'aksedge-local', type: 'aksedge-local', tools: {} });
  if (!provider) throw new Error('Missing local provider policy');
  expect(resolveClusterRegistrationRuntime(manifest, provider, resources)).toEqual({
    resourcesPath: resources,
    tools: {},
  });
  const args = ['versions', '--json'];
  const send = await invoke(args);
  expect(mocks.executable).toHaveBeenCalledExactlyOnceWith('aksedge', args, true);
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
  fs.cpSync(path.dirname(path.dirname(executable)), path.join(roots.user, 'aksedge'), {
    recursive: true,
  });
  const result = await capabilities({
    ...registration,
    source: 'user',
    type: 'user',
    path: 'user-plugins/aksedge',
  });
  expect(result.capabilities).toHaveLength(0);
});

it('never substitutes PATH or a product executable when the declared binary is absent', async () => {
  fs.unlinkSync(executable);
  const send = await invoke(['versions', '--json']);
  expect(send).toHaveBeenCalledWith('command-exit', 'mock-operation', -2);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it('requires native consent and persists a user denial in the mocked settings only', async () => {
  consent = {};
  const send = await invoke(['versions', '--json']);
  expect(mocks.dialog).toHaveBeenCalledOnce();
  expect(mocks.saveSettings).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith('command-exit', 'mock-operation', -3);
  expect(mocks.executable).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it('honors saved denial even when other operations have approval', async () => {
  consent[consentKey(['versions', '--json'])] = false;
  const send = await invoke(['versions', '--json']);
  expect(send).toHaveBeenCalledWith('command-exit', 'mock-operation', -3);
  expect(mocks.dialog).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it.each([
  ['versions', '--json', '--unexpected'],
  ['status', ...prefix, '--name', 'demo'],
  ['status', ...prefix.map(value => (value === 'Ubuntu-24.04' ? 'Ubuntu' : value))],
])('rejects arguments outside the product grant: %j', async (...args) => {
  const send = await invoke(args);
  expect(send).toHaveBeenCalledWith('command-exit', 'mock-operation', -2);
  expect(mocks.executable).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it.each([
  ['delete', ...prefix, ...configuration, '--purge'],
  ['delete', ...prefix, '--name', '../bad', '--k8s-version', '1.36.1-20260701'],
  ['create', ...prefix, ...configuration, '--kubeconfig-out', 'C:\\not-a-private-handoff.yaml'],
  ['kubeconfig', ...prefix, ...configuration, '--kubeconfig-out', 'C:\\not-a-private-handoff.yaml'],
])('enforces full native validation after the variable-argument grant: %j', async (...args) => {
  const send = await invoke(args);
  expect(mocks.executable).toHaveBeenCalledExactlyOnceWith('aksedge', args, true);
  expect(send).toHaveBeenCalledWith('command-exit', 'mock-operation', -1);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it.each(['create', 'kubeconfig'])(
  'accepts only the native private-file shape for %s',
  async command => {
    privateDirectory = path.join(
      fs.realpathSync(os.tmpdir()),
      `aksedge-kubeconfig-${crypto.randomUUID()}`
    );
    fs.mkdirSync(privateDirectory);
    const output = path.join(privateDirectory, 'credentials.yaml');
    fs.writeFileSync(output, '');
    const args = [command, ...prefix, ...configuration, '--kubeconfig-out', output];
    await invoke(args);
    expect(mocks.executable).toHaveBeenCalledExactlyOnceWith('aksedge', args, true);
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
    await invoke(['versions', '--json'], options, url, revoked);
  }
  expect(mocks.environment).not.toHaveBeenCalled();
  expect(mocks.executable).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});
