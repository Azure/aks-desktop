// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  stdout: { setEncoding: vi.fn() },
  stderr: { setEncoding: vi.fn() },
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { ARM_SCOPE } from '../azure/az-token';
import { createAzureLiveAuthBridge } from './azureLiveAuthBridge';

const subscriptionId = '11111111-2222-3333-4444-555555555555';
const tokenArgs = [
  'account',
  'get-access-token',
  '--scope',
  ARM_SCOPE,
  '-o',
  'json',
  '--subscription',
  subscriptionId,
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.spawn.mockReturnValue({ stdout: mocks.stdout, stderr: mocks.stderr });
});

describe('restricted Azure live authentication bridge', () => {
  test.each([
    ARM_SCOPE,
    'https://management.core.windows.net/.default',
    'https://management.core.windows.net//.default',
  ])('allows selected-account authentication for public ARM scope %s', scope => {
    const bridge = createAzureLiveAuthBridge(subscriptionId);
    const args = [...tokenArgs];
    args[3] = scope;
    bridge.runCommand('az', args);
    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('az', args, {
      shell: process.platform === 'win32',
    });
    expect(bridge.tokenRequests).toBe(1);
    expect(bridge.cloudReads).toBe(0);
    expect(mocks.stdout.setEncoding).toHaveBeenCalledWith('utf8');
    expect(mocks.stderr.setEncoding).toHaveBeenCalledWith('utf8');
  });

  test.each([
    ['cloud', 'show', '--output', 'json'],
    ['cloud', 'show', '--name', 'AzureCloud', '--output', 'json'],
  ])('allows local metadata read %j', (...args) => {
    const bridge = createAzureLiveAuthBridge(subscriptionId);
    bridge.runCommand('az', args);
    expect(bridge.cloudReads).toBe(1);
    expect(bridge.tokenRequests).toBe(0);
  });

  test.each([
    ['provider', 'register'],
    ['group', 'delete'],
    ['rest', '--method', 'DELETE'],
    ['cloud', 'set', '--name', 'AzureCloud'],
    ['cloud', 'show', '--name', 'AzureUSGovernment', '--output', 'json'],
    ['cloud', 'register', '--name', 'Other'],
    ['account', 'show'],
    ['cloud\0show', '--output', 'json'],
    tokenArgs.slice(0, 6),
    [...tokenArgs, '--tenant', subscriptionId],
    [...tokenArgs.slice(0, 7), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
    [...tokenArgs.slice(0, 3), 'https://graph.microsoft.com/.default', ...tokenArgs.slice(4)],
    [...tokenArgs.slice(0, 3), `${ARM_SCOPE}&other-command`, ...tokenArgs.slice(4)],
    [...tokenArgs.slice(0, 5), 'tsv', ...tokenArgs.slice(6)],
  ])('rejects unsupported arguments before spawning: %j', (...args) => {
    const bridge = createAzureLiveAuthBridge(subscriptionId);
    expect(() => bridge.runCommand('az', args)).toThrow('Only selected-account');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(bridge.tokenRequests).toBe(0);
    expect(bridge.cloudReads).toBe(0);
  });

  test('supports the Windows launcher without expanding the command allowlist', () => {
    createAzureLiveAuthBridge(subscriptionId, 'win32').runCommand('az.cmd', tokenArgs);
    expect(mocks.spawn).toHaveBeenCalledWith('az.cmd', tokenArgs, { shell: true });
  });

  test('rejects other executables and malformed subscription selectors', () => {
    expect(() => createAzureLiveAuthBridge('not-a-guid')).toThrow('subscription GUID');
    expect(() => createAzureLiveAuthBridge(subscriptionId).runCommand('sh', tokenArgs)).toThrow(
      'Only the Azure CLI'
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  test('leaves installation and restoration of the command global to its caller', () => {
    const original = Reflect.get(globalThis, 'pluginRunCommand');
    createAzureLiveAuthBridge(subscriptionId);
    expect(Reflect.get(globalThis, 'pluginRunCommand')).toBe(original);
  });
});
