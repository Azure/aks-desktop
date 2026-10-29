// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { getKubeletIdentityObjectId } from './az-identity';

const options = {
  subscriptionId: '11111111-2222-3333-4444-555555555555',
  resourceGroup: 'my-rg',
  clusterName: 'my-aks',
  credential: {
    getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600_000 }),
  },
};
beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  expect(mocks.command).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('getKubeletIdentityObjectId', () => {
  test.each([
    ['not-a-guid', 'my-rg', 'my-aks', 'subscription ID'],
    [options.subscriptionId, 'bad group!', 'my-aks', 'resource group or cluster name'],
    [options.subscriptionId, 'my-rg', 'bad cluster!', 'resource group or cluster name'],
  ])(
    'validates input without a REST or CLI request',
    async (subscriptionId, resourceGroup, clusterName, error) => {
      expect(
        await getKubeletIdentityObjectId({ ...options, subscriptionId, resourceGroup, clusterName })
      ).toMatchObject({ success: false, error: expect.stringContaining(error) });
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  test.each([null, 12345, {}, { objectId: 'not-a-guid-format' }])(
    'rejects malformed or missing kubelet identity %j',
    async kubeletidentity => {
      mocks.fetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            properties: { identityProfile: { kubeletidentity } },
          })
        )
      );
      expect(await getKubeletIdentityObjectId(options)).toMatchObject({
        success: false,
        error: expect.stringContaining('kubelet identity'),
      });
    }
  );
});
