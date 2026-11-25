// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../constants/projectLabels';
import { createLiveAksCluster, waitForLiveAksCluster } from '../test/azureLiveAksTestUtils';
import { type AzureLiveAuthBridge, createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import { getLiveNamespaceReader } from '../test/azureLiveKubernetesTestUtils';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getAzureCloudEndpoints } from './az-cloud';
import { azRequest } from './az-http';
import { createManagedNamespace } from './az-namespaces';
import { getSubscriptionCredential } from './az-token';

describe.runIf(azureLiveEnabled)(
  'managed namespace creation REST E2E',
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

    test('creates namespaces with CLI defaults and explicit policies through production authentication', async () => {
      await withAzureTestResourceGroup('namespace-create', context, async run => {
        const cluster = await createLiveAksCluster(run);
        const readNamespace = await getLiveNamespaceReader(cluster);
        for (const explicitPolicies of [false, true]) {
          const namespaceName = explicitPolicies ? 'rest-e2e-policies' : 'rest-e2e-defaults';
          const labels = {
            [PROJECT_ID_LABEL]: namespaceName,
            [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
            [SUBSCRIPTION_LABEL]: run.subscriptionId,
            [RESOURCE_GROUP_LABEL]: run.resourceGroup,
          };
          const annotations = { 'aks-desktop-test/run-id': run.runId };
          await waitForLiveAksCluster(cluster, Date.now() + 5 * 60_000);
          console.info(`Creating test managed namespace ${namespaceName}`);
          const result = await createManagedNamespace({
            subscriptionId: run.subscriptionId,
            tenantId: run.tenantId,
            resourceGroup: run.resourceGroup,
            clusterName: cluster.clusterName,
            namespaceName,
            cpuRequest: 250,
            cpuLimit: 1500,
            memoryRequest: 128,
            memoryLimit: 1536,
            labels,
            annotations,
            ...(explicitPolicies
              ? { ingressPolicy: 'DenyAll' as const, egressPolicy: 'AllowSameNamespace' as const }
              : {}),
          });
          expect(result).toEqual({ success: true, stdout: '', stderr: '' });
          const url = `${run.resourceGroupId}/providers/Microsoft.ContainerService/managedClusters/${cluster.clusterName}/managedNamespaces/${namespaceName}`;
          const namespace = await azRequest({
            ...run,
            url,
            apiVersion: '2026-01-01',
          });
          expect(namespace).toMatchObject({
            location: run.location,
            properties: {
              provisioningState: 'Succeeded',
              adoptionPolicy: 'Never',
              deletePolicy: 'Keep',
              labels,
              annotations,
              defaultResourceQuota: {
                cpuRequest: '250m',
                cpuLimit: '1500m',
                memoryRequest: '128Mi',
                memoryLimit: '1536Mi',
              },
              defaultNetworkPolicy: explicitPolicies
                ? { ingress: 'DenyAll', egress: 'AllowSameNamespace' }
                : { ingress: 'AllowSameNamespace', egress: 'AllowAll' },
            },
          });
          expect(await readNamespace(namespaceName)).toMatchObject({
            metadata: { name: namespaceName, labels },
          });
        }
        expect(bridge.tokenRequests).toBe(1);
        expect(bridge.cloudReads).toBe(1);
      });
    });
  }
);
