// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  createAzureAuthLiveStorage,
  readLiveAzure,
  runReadOnlyAzureAuthCommand,
  validateLiveAzureSubscription,
} from '../test/azureAuthLiveTestUtils';
import { getLoginStatus } from './az-auth';
import { getAzureCloudEndpoints } from './az-cloud';
import { azRequest } from './az-http';
import { getSubscriptionCredential } from './az-token';

describe.runIf(process.env.AZ_LIVE_TESTS === '1')(
  'cached Azure authentication (live, read-only)',
  () => {
    let tokenRequests = 0;
    beforeAll(() => {
      for (const method of ['debug', 'log', 'info', 'warn', 'error'] as const) {
        vi.spyOn(console, method).mockImplementation(() => {});
      }
      vi.stubGlobal('pluginRunCommand', (executable: string, args: string[]) => {
        const child = runReadOnlyAzureAuthCommand(executable, args);
        if (args[0] === 'account' && args[1] === 'get-access-token') tokenRequests++;
        return child;
      });
      vi.stubGlobal('localStorage', createAzureAuthLiveStorage());
    });
    afterAll(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    test('uses the cached account and reuses a subscription-bound token for real ARM reads', async () => {
      const account = await readLiveAzure(getLoginStatus);
      if (!account.isLoggedIn || !account.subscriptionId || !account.tenantId) {
        throw new Error('A cached Azure login is required; the live runner never starts az login.');
      }
      if (account.environmentName !== 'AzureCloud') {
        throw new Error(
          'These live tests require the existing public Azure cloud; they never switch it.'
        );
      }
      const cloud = await readLiveAzure(() => getAzureCloudEndpoints());
      const credential = getSubscriptionCredential(account.subscriptionId);
      const first = await readLiveAzure(() =>
        credential.getToken(cloud.scope, { tenantId: account.tenantId })
      );
      const second = await readLiveAzure(() =>
        credential.getToken(cloud.scope, { tenantId: account.tenantId })
      );
      expect(first.token === second.token).toBe(true);
      expect(first.expiresOnTimestamp > Date.now()).toBe(true);
      const subscription = await readLiveAzure(() =>
        azRequest<{ subscriptionId: string; tenantId: string }>({
          ...cloud,
          credential,
          tenantId: account.tenantId,
          url: `/subscriptions/${account.subscriptionId}`,
          apiVersion: '2022-12-01',
        })
      );
      validateLiveAzureSubscription(subscription, account.subscriptionId);
      expect(tokenRequests).toBe(1);
    }, 90_000);
  }
);
