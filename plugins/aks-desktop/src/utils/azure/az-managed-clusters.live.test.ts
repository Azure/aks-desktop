// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createLiveAksCluster } from '../test/azureLiveAksTestUtils';
import { type AzureLiveAuthBridge, createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getAzureCloudEndpoints } from './az-cloud';
import { getAksClusterStatus, getClusterCapabilities } from './az-clusters';
import { getAksOidcIssuerUrl } from './az-federation';
import { getKubeletIdentityObjectId } from './az-identity';
import { getManagedClusterDetails } from './az-managed-clusters';
import { getSubscriptionCredential } from './az-token';

describe.runIf(azureLiveEnabled)(
  'managed AKS detail REST E2E',
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

    test('projects a fresh run-owned AKS cluster through every detail consumer', async () => {
      await withAzureTestResourceGroup('cluster-details', context, async run => {
        const created = await createLiveAksCluster(run);
        const options = {
          subscriptionId: run.subscriptionId,
          tenantId: run.tenantId,
          resourceGroup: run.resourceGroup,
          clusterName: created.clusterName,
        };
        const cluster = await getManagedClusterDetails(options);
        const properties = cluster.properties;
        expect(cluster.id?.toLowerCase()).toBe(
          `${run.resourceGroupId}/providers/Microsoft.ContainerService/managedClusters/aks`.toLowerCase()
        );
        expect(cluster.type?.toLowerCase()).toBe('microsoft.containerservice/managedclusters');
        expect(cluster.name).toBe('aks');
        expect(cluster.sku).toMatchObject({ name: 'Base', tier: 'Free' });
        expect(await getAksClusterStatus(options)).toEqual({
          provisioningState: 'Succeeded',
          powerState: 'Running',
          kubernetesVersion: properties.kubernetesVersion,
          ready: true,
        });
        expect(await getClusterCapabilities(options)).toEqual({
          sku: 'Base',
          tier: 'Free',
          location: run.location,
          aadEnabled: true,
          azureRbacEnabled: true,
          kubernetesVersion: properties.kubernetesVersion,
          networkPlugin: 'azure',
          networkPolicy: properties.networkProfile?.networkPolicy || 'none',
          prometheusEnabled: properties.azureMonitorProfile?.metrics?.enabled ?? null,
          containerInsightsEnabled: properties.addonProfiles?.omsagent?.enabled ?? null,
          kedaEnabled: properties.workloadAutoScalerProfile?.keda?.enabled ?? null,
          vpaEnabled: properties.workloadAutoScalerProfile?.verticalPodAutoscaler?.enabled ?? null,
        });
        const kubelet = properties.identityProfile?.kubeletidentity;
        if (
          !kubelet ||
          typeof kubelet !== 'object' ||
          !('objectId' in kubelet) ||
          typeof kubelet.objectId !== 'string'
        ) {
          throw new Error('ARM returned no kubelet object ID for the test cluster');
        }
        expect(kubelet.objectId).toMatch(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i);
        expect(await getKubeletIdentityObjectId(options)).toEqual({
          success: true,
          objectId: kubelet.objectId,
        });
        expect(properties.oidcIssuerProfile?.enabled).toBe(true);
        expect(properties.oidcIssuerProfile?.issuerURL).toMatch(/^https:\/\//);
        expect(properties.securityProfile?.workloadIdentity?.enabled).toBe(true);
        expect(await getAksOidcIssuerUrl(options)).toEqual({
          success: true,
          issuerUrl: properties.oidcIssuerProfile?.issuerURL,
        });
        expect(bridge.tokenRequests).toBe(1);
        expect(bridge.cloudReads).toBe(1);
      });
    });
  }
);
