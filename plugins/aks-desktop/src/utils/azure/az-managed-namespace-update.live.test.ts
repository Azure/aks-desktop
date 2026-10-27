// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createLiveAksCluster } from '../test/azureLiveAksTestUtils';
import { type AzureLiveAuthBridge, createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import { createLiveManagedNamespace } from '../test/azureLiveKubernetesTestUtils';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getAzureCloudEndpoints } from './az-cloud';
import {
  getManagedNamespaceResource,
  type ManagedNamespaceResource,
  updateManagedNamespaceResource,
} from './az-managed-namespace-update';
import { getSubscriptionCredential } from './az-token';

describe.runIf(azureLiveEnabled)(
  'managed namespace update REST E2E',
  { timeout: AZURE_LIVE_TEST_TIMEOUT + 30 * 60_000 },
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

    test('reads, updates quotas/labels losslessly, and polls completion on a live managed namespace', async () => {
      await withAzureTestResourceGroup('namespace-update', context, async run => {
        const cluster = await createLiveAksCluster(run);
        const namespaceName = 'rest-e2e-update';
        await createLiveManagedNamespace(cluster, namespaceName, 'Delete');

        const scope = {
          subscriptionId: run.subscriptionId,
          resourceGroup: run.resourceGroup,
          clusterName: cluster.clusterName,
          namespaceName,
        };

        const initial = await getManagedNamespaceResource(scope);
        expect(initial.name).toBe(namespaceName);
        expect(initial.properties.provisioningState).toBe('Succeeded');

        const initialQuota = (initial.properties.defaultResourceQuota ?? {}) as Record<
          string,
          string | undefined
        >;
        const nextCpuRequest = initialQuota.cpuRequest === '250m' ? 350 : 250;
        const nextCpuLimit = initialQuota.cpuLimit === '1000m' ? 1200 : 1000;
        const nextMemoryRequest = initialQuota.memoryRequest === '256Mi' ? 384 : 256;
        const nextMemoryLimit = initialQuota.memoryLimit === '1536Mi' ? 2048 : 1536;
        const expectedQuota = {
          cpuRequest: `${nextCpuRequest}m`,
          cpuLimit: `${nextCpuLimit}m`,
          memoryRequest: `${nextMemoryRequest}Mi`,
          memoryLimit: `${nextMemoryLimit}Mi`,
        };

        const quotaUpdated = (await updateManagedNamespaceResource({
          ...scope,
          cpuRequest: nextCpuRequest,
          cpuLimit: nextCpuLimit,
          memoryRequest: nextMemoryRequest,
          memoryLimit: nextMemoryLimit,
        })) as ManagedNamespaceResource;
        expect(quotaUpdated.properties.provisioningState).toBe('Succeeded');
        expect(quotaUpdated.properties.defaultResourceQuota).toMatchObject(expectedQuota);
        expect(quotaUpdated.tags).toEqual(initial.tags);
        expect(quotaUpdated.properties.labels).toEqual(initial.properties.labels);
        expect(quotaUpdated.properties.defaultNetworkPolicy).toEqual(
          initial.properties.defaultNetworkPolicy
        );
        expect(quotaUpdated.properties.adoptionPolicy).toEqual(initial.properties.adoptionPolicy);
        expect(quotaUpdated.properties.deletePolicy).toEqual(initial.properties.deletePolicy);

        const labelUpdated = (await updateManagedNamespaceResource({
          ...scope,
          labels: { 'aks-desktop.io/test': 'updated' },
        })) as ManagedNamespaceResource;
        expect(labelUpdated.properties.provisioningState).toBe('Succeeded');
        expect(labelUpdated.properties.defaultResourceQuota).toMatchObject(expectedQuota);
        expect(labelUpdated.tags).toEqual(initial.tags);
        expect(labelUpdated.properties.labels).toEqual({
          ...(initial.properties.labels as Record<string, string> | undefined),
          'aks-desktop.io/test': 'updated',
        });
        expect(labelUpdated.properties.defaultNetworkPolicy).toEqual(
          initial.properties.defaultNetworkPolicy
        );
        expect(labelUpdated.properties.adoptionPolicy).toEqual(initial.properties.adoptionPolicy);
        expect(labelUpdated.properties.deletePolicy).toEqual(initial.properties.deletePolicy);

        const reread = await getManagedNamespaceResource(scope);
        expect(reread.properties.defaultResourceQuota).toEqual(
          labelUpdated.properties.defaultResourceQuota
        );
        expect(reread.tags).toEqual(initial.tags);
        expect(reread.properties.labels).toEqual(labelUpdated.properties.labels);
        expect(reread.properties.defaultNetworkPolicy).toEqual(
          initial.properties.defaultNetworkPolicy
        );
        expect(reread.properties.adoptionPolicy).toEqual(initial.properties.adoptionPolicy);
        expect(reread.properties.deletePolicy).toEqual(initial.properties.deletePolicy);
      });
    });
  }
);
