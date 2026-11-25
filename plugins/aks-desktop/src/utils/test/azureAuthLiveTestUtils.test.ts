// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  stdout: { setEncoding: vi.fn() },
  stderr: { setEncoding: vi.fn() },
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import {
  readLiveAzure,
  runReadOnlyAzureAuthCommand,
  validateLiveAzureSubscription,
} from './azureAuthLiveTestUtils';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spawn.mockReturnValue({ stdout: mocks.stdout, stderr: mocks.stderr });
});

test.each([
  ['login'],
  ['logout'],
  ['account', 'set', '--subscription', '11111111-2222-3333-4444-555555555555'],
  ['cloud', 'set', '--name', 'AzureCloud'],
  ['group', 'list', '-o', 'json'],
  ['account', 'get-access-token', '--scope', 'https://untrusted.example/.default'],
])('rejects interactive, identity-changing or unapproved commands: %j', (...args) => {
  expect(() => runReadOnlyAzureAuthCommand('az', args)).toThrow('only read-only');
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test.each([
  ['account', 'show', '-o', 'json'],
  [
    'account',
    'get-access-token',
    '--scope',
    'https://management.azure.com/.default',
    '-o',
    'json',
    '--subscription',
    '11111111-2222-3333-4444-555555555555',
  ],
])('closes stdin and bounds cached credential reads: %j', (...args) => {
  runReadOnlyAzureAuthCommand('az', args);
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('az', args, {
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
});

test('does not expose credential or account details when a live request fails', async () => {
  await expect(
    readLiveAzure(async () => {
      throw new Error('sensitive response fixture');
    })
  ).rejects.toThrow('renew cached Azure credentials outside the test runner');
  await expect(
    readLiveAzure(async () => {
      throw new Error('sensitive response fixture');
    })
  ).rejects.not.toThrow('sensitive response fixture');
});

test('accepts valid owning-tenant metadata for a delegated subscription', () => {
  const subscription = '11111111-2222-3333-4444-555555555555';
  expect(() =>
    validateLiveAzureSubscription(
      {
        subscriptionId: subscription.toUpperCase(),
        tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      },
      subscription
    )
  ).not.toThrow();
});

test.each([
  undefined,
  { subscriptionId: '11111111-2222-3333-4444-555555555555', tenantId: 'invalid' },
  {
    subscriptionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tenantId: '11111111-2222-3333-4444-555555555555',
  },
])('rejects malformed or mismatched live subscription metadata: %j', value => {
  expect(() =>
    validateLiveAzureSubscription(value, '11111111-2222-3333-4444-555555555555')
  ).toThrow('invalid subscription or tenant metadata');
});
