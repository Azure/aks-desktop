// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  createAzureAuthLiveStorage,
  readLiveAzure,
  runReadOnlyAzureAuthCommand,
} from '../test/azureAuthLiveTestUtils';
import { getLoginStatus } from './az-auth';
import { getClusterInfo, getClusterResourceIdAndGroup, getClusters } from './az-clusters';

describe.runIf(process.env.AZ_LIVE_TESTS === '1')(
  'Azure feature authentication (live, read-only)',
  () => {
    beforeAll(() => {
      for (const method of ['debug', 'log', 'info', 'warn', 'error'] as const) {
        vi.spyOn(console, method).mockImplementation(() => {});
      }
      vi.stubGlobal('localStorage', createAzureAuthLiveStorage());
      vi.stubGlobal('pluginRunCommand', runReadOnlyAzureAuthCommand);
    });
    afterAll(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    test('lists clusters and resolves an existing identity or confirms absence', async context => {
      const account = await readLiveAzure(getLoginStatus);
      if (!account.isLoggedIn || !account.subscriptionId || !account.tenantId) {
        throw new Error('A cached Azure login is required; the live runner never starts az login.');
      }
      if (account.environmentName !== 'AzureCloud') {
        throw new Error(
          'These live tests require the existing public Azure cloud; they never switch it.'
        );
      }
      const subscriptionId = account.subscriptionId;
      const clusters = await readLiveAzure(() => getClusters(subscriptionId));
      expect(Array.isArray(clusters)).toBe(true);
      expect(clusters.every(cluster => typeof cluster.name === 'string')).toBe(true);
      const cluster = clusters.find(
        value =>
          typeof value.name === 'string' &&
          typeof value.resourceGroup === 'string' &&
          clusters.filter(other => other.name === value.name).length === 1
      );
      if (!cluster && clusters.length > 0) {
        context.skip('No uniquely named managed AKS cluster in the current subscription.');
        return;
      }
      const name = cluster?.name ?? `aksd-auth-live-missing-${randomUUID()}`;
      const identity = await readLiveAzure(() =>
        getClusterResourceIdAndGroup(name, subscriptionId)
      );
      if (!cluster) {
        expect(identity === null).toBe(true);
        return;
      }
      expect(identity?.resourceGroup === cluster.resourceGroup).toBe(true);
      const info = await readLiveAzure(() => getClusterInfo(cluster.name));
      expect(info.subscriptionId === account.subscriptionId).toBe(true);
      expect(info.tenantId === account.tenantId).toBe(true);
      expect(info.resourceGroup === cluster.resourceGroup).toBe(true);
    }, 120_000);
  }
);
