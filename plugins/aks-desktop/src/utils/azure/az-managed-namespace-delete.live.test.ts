// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createLiveAksCluster } from '../test/azureLiveAksTestUtils';
import { type AzureLiveAuthBridge, createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import {
  createLiveManagedNamespace,
  getLiveNamespaceReader,
} from '../test/azureLiveKubernetesTestUtils';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getAzureCloudEndpoints } from './az-cloud';
import { azRequest } from './az-http';
import { deleteManagedNamespace } from './az-namespaces';
import { getSubscriptionCredential } from './az-token';

describe.runIf(azureLiveEnabled)(
  'managed namespace deletion REST E2E',
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

    test('observes deletion, honors Keep/Delete and preserves a retained Kubernetes namespace', async () => {
      await withAzureTestResourceGroup('namespace-delete', context, async run => {
        const cluster = await createLiveAksCluster(run);
        console.info('Created test AKS cluster; acquiring ephemeral Kubernetes admin credentials');
        const readNamespace = await getLiveNamespaceReader(cluster);
        for (const deletePolicy of ['Keep', 'Delete'] as const) {
          const namespaceName = `rest-e2e-${deletePolicy.toLowerCase()}`;
          console.info(`Creating run-owned managed namespace for ${deletePolicy} retention`);
          const url = await createLiveManagedNamespace(cluster, namespaceName, deletePolicy);
          expect((await readNamespace(namespaceName))?.metadata?.name).toBe(namespaceName);
          console.info(
            `Checking managed namespace ${namespaceName} with ${deletePolicy} retention`
          );
          const deletionOptions = {
            subscriptionId: run.subscriptionId,
            tenantId: run.tenantId,
            resourceGroup: run.resourceGroup,
            clusterName: cluster.clusterName,
            namespaceName,
          };
          const deletion = await deleteManagedNamespace(deletionOptions);
          expect(deletion.error).toBeUndefined();
          expect(deletion.success).toBe(true);
          await expect(azRequest({ ...run, url, apiVersion: '2026-01-01' })).rejects.toMatchObject({
            status: 404,
          });
          if (deletePolicy === 'Keep') {
            expect((await readNamespace(namespaceName))?.metadata?.name).toBe(namespaceName);
          } else {
            const deletedBy = Date.now() + 5 * 60_000;
            while (await readNamespace(namespaceName)) {
              if (Date.now() >= deletedBy)
                throw new Error('Delete policy did not remove the Kubernetes namespace');
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          const repeated = await deleteManagedNamespace(deletionOptions);
          expect(repeated.error).toBeUndefined();
          expect(repeated.success).toBe(true);
          console.info(`Verified ${deletePolicy} retention for ${namespaceName}`);
        }
        expect(bridge.tokenRequests).toBe(1);
        expect(bridge.cloudReads).toBe(1);
      });
    });
  }
);
