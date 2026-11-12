// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { type AzureLiveAuthBridge, createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { isValidGuid } from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import { azRequest } from './az-http';
import {
  createManagedIdentity,
  getManagedIdentity,
  listManagedIdentities,
} from './az-managed-identities';
import { getSubscriptionCredential } from './az-token';

describe.runIf(azureLiveEnabled)(
  'managed identity REST E2E',
  { timeout: AZURE_LIVE_TEST_TIMEOUT },
  () => {
    let context: ReturnType<typeof getLiveAzureContext>;
    let bridge: AzureLiveAuthBridge;
    beforeAll(async () => {
      context = getLiveAzureContext();
      bridge = createAzureLiveAuthBridge(context.subscriptionId);
      vi.stubGlobal('pluginRunCommand', bridge.runCommand);
      getSubscriptionCredential(context.subscriptionId).clearCache();
      expect((await getAzureCloudEndpoints()).endpoint).toBe('https://management.azure.com');
    }, 70_000);
    afterAll(() => vi.unstubAllGlobals());

    test('gets and lists a workload identity created in a fresh resource group', async () => {
      await withAzureTestResourceGroup('managed-identity', context, async run => {
        const group = { resourceGroup: run.resourceGroup, subscriptionId: run.subscriptionId };
        const options = { ...group, identityName: 'workload-identity' };

        expect(await getManagedIdentity(options)).toEqual({ success: false, notFound: true });
        expect(await listManagedIdentities(group)).toEqual({ success: true, identities: [] });

        const created = await createManagedIdentity(options);
        expect(created.error).toBeUndefined();
        expect(created.success).toBe(true);
        expect(isValidGuid(created.clientId ?? '')).toBe(true);
        expect(isValidGuid(created.principalId ?? '')).toBe(true);
        expect(created.tenantId?.toLowerCase()).toBe(run.tenantId.toLowerCase());

        const identity = await azRequest({
          ...run,
          url: `${run.resourceGroupId}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${options.identityName}`,
          apiVersion: '2023-01-31',
        });
        expect(identity).toMatchObject({
          location: run.location,
          tags: { purpose: 'workload-identity', createdBy: 'AKS Desktop' },
          properties: {
            clientId: created.clientId,
            principalId: created.principalId,
            tenantId: created.tenantId,
          },
        });
        expect(await getManagedIdentity(options)).toEqual(created);
        expect(await listManagedIdentities(group)).toEqual({
          success: true,
          identities: [
            {
              name: options.identityName,
              resourceGroup: run.resourceGroup,
              clientId: created.clientId,
              principalId: created.principalId,
            },
          ],
        });
        expect(bridge.tokenRequests).toBe(1);
        expect(bridge.cloudReads).toBe(1);
      });
    });
  }
);
