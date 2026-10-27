// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { getManagedClusterDetails } from './az-managed-clusters';
import { getSubscriptionCredential } from './az-token';

const subscriptionId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
beforeEach(() => {
  getSubscriptionCredential(subscriptionId).clearCache();
  mocks.command.mockReset().mockResolvedValue({
    stdout: JSON.stringify({
      accessToken: 'test-token',
      expires_on: Math.floor(Date.now() / 1000) + 3600,
      tenant: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    }),
    stderr: '',
  });
  mocks.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ properties: {} })));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

test.each([undefined, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'])(
  'authenticates a non-injected read with supported selectors for tenant %s',
  async tenantId => {
    await expect(
      getManagedClusterDetails({
        subscriptionId,
        tenantId,
        resourceGroup: 'rg',
        clusterName: 'aks',
      })
    ).resolves.toEqual({ properties: {} });
    const args = mocks.command.mock.calls[0][1] as string[];
    expect(args.slice(0, 2)).toEqual(['account', 'get-access-token']);
    expect(args.includes('--tenant')).toBe(false);
    expect(args.includes('--subscription')).toBe(true);
    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(String(mocks.fetch.mock.calls[0][0])).toContain(`/subscriptions/${subscriptionId}/`);
  }
);
