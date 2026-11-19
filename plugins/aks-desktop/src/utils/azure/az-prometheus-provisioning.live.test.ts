// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createLiveAksCluster, waitForLiveAksCluster } from '../test/azureLiveAksTestUtils';
import { type AzureLiveAuthBridge, createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getAzureCloudEndpoints } from './az-cloud';
import { azListAll, azRequest, type AzRequestOptions, AzureRequestError } from './az-http';
import {
  enableClusterAddonsViaRest,
  resolveDefaultMonitorWorkspace,
} from './az-prometheus-provisioning';
import { getSubscriptionCredential } from './az-token';

async function resourceExists(
  run: Omit<AzRequestOptions, 'url'>,
  url: string,
  apiVersion: string
): Promise<boolean> {
  try {
    await azRequest({ ...run, url, apiVersion });
    return true;
  } catch (error) {
    if (error instanceof AzureRequestError && error.status === 404) return false;
    throw error;
  }
}

describe.runIf(azureLiveEnabled)(
  'managed Prometheus provisioning REST E2E',
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

    test('provisions Prometheus artifacts, enables addons and is idempotent on re-run', async () => {
      await withAzureTestResourceGroup('prometheus', context, async run => {
        const cluster = await createLiveAksCluster(run);
        const clusterUrl = `${run.resourceGroupId}/providers/Microsoft.ContainerService/managedClusters/${cluster.clusterName}`;
        const { rgUrl: defaultRgUrl, amwId: defaultAmwUrl } = await resolveDefaultMonitorWorkspace(
          run.subscriptionId,
          run.location,
          run
        );

        const defaultRgExisted = await resourceExists(run, defaultRgUrl, '2021-04-01');
        const defaultAmwExisted =
          defaultRgExisted && (await resourceExists(run, defaultAmwUrl, '2023-04-03'));

        try {
          const enableResult = await enableClusterAddonsViaRest({
            subscriptionId: run.subscriptionId,
            tenantId: run.tenantId,
            resourceGroup: run.resourceGroup,
            clusterName: cluster.clusterName,
            addon: ['azure-monitor-metrics', 'keda'],
          });
          expect(enableResult).toEqual({ success: true });

          await waitForLiveAksCluster(cluster, Date.now() + 20 * 60_000);

          const updated = await azRequest<{
            properties?: {
              azureMonitorProfile?: { metrics?: { enabled?: boolean } };
              workloadAutoScalerProfile?: { keda?: { enabled?: boolean } };
            };
          }>({
            ...run,
            url: clusterUrl,
            apiVersion: '2026-01-01',
          });
          expect(updated.properties?.azureMonitorProfile?.metrics?.enabled).toBe(true);
          expect(updated.properties?.workloadAutoScalerProfile?.keda?.enabled).toBe(true);

          const dcrs = await azListAll<{
            properties?: {
              destinations?: { monitoringAccounts?: Array<{ accountResourceId?: string }> };
            };
          }>({
            ...run,
            url: `${run.resourceGroupId}/providers/Microsoft.Insights/dataCollectionRules`,
            apiVersion: '2022-06-01',
          });
          const amwId =
            dcrs[0]?.properties?.destinations?.monitoringAccounts?.[0]?.accountResourceId;
          expect(amwId).toBeTruthy();

          const workspace = await azRequest<{
            id?: string;
            properties?: { provisioningState?: string };
          }>({
            ...run,
            url: amwId!,
            apiVersion: '2023-04-03',
          });
          expect(workspace?.id?.toLowerCase()).toBe(amwId!.toLowerCase());

          const rerunResult = await enableClusterAddonsViaRest({
            subscriptionId: run.subscriptionId,
            tenantId: run.tenantId,
            resourceGroup: run.resourceGroup,
            clusterName: cluster.clusterName,
            addon: 'azure-monitor-metrics',
          });
          expect(rerunResult).toEqual({ success: true });

          expect(bridge.tokenRequests).toBe(1);
          expect(bridge.cloudReads).toBe(1);
        } finally {
          if (!defaultAmwExisted) {
            await azRequest({
              ...run,
              url: defaultAmwUrl,
              apiVersion: '2023-04-03',
              method: 'DELETE',
            }).catch(() => {});
          }
          if (!defaultRgExisted) {
            await azRequest({
              ...run,
              url: defaultRgUrl,
              apiVersion: '2021-04-01',
              method: 'DELETE',
            }).catch(() => {});
          }
        }
      });
    });
  }
);
