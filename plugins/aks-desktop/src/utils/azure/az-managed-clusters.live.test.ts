// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createLiveAksCluster } from '../test/azureLiveAksTestUtils';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getAksClusterStatus, getClusterCapabilities } from './az-clusters';
import { getAksOidcIssuerUrl } from './az-federation';
import { getKubeletIdentityObjectId } from './az-identity';
import { getManagedClusterDetails } from './az-managed-clusters';

describe.runIf(azureLiveEnabled)(
  'managed AKS detail REST E2E',
  { timeout: AZURE_LIVE_TEST_TIMEOUT },
  () => {
    let context: ReturnType<typeof getLiveAzureContext>;
    const command = vi.fn(() => {
      throw new Error('Resource operations must not execute Azure CLI');
    });
    beforeAll(() => {
      context = getLiveAzureContext();
      vi.stubGlobal('pluginRunCommand', command);
    }, 70_000);
    afterAll(() => vi.unstubAllGlobals());

    test('projects a fresh run-owned AKS cluster through every detail consumer', async () => {
      await withAzureTestResourceGroup('cluster-details', context, async run => {
        const options = await createLiveAksCluster(run);
        const cluster = await getManagedClusterDetails(options);
        expect(cluster.sku).toMatchObject({ name: 'Base', tier: 'Free' });
        expect(await getAksClusterStatus(options)).toMatchObject({
          provisioningState: 'Succeeded',
          powerState: 'Running',
          ready: true,
        });
        expect(await getClusterCapabilities(options)).toMatchObject({
          sku: 'Base',
          tier: 'Free',
          location: run.location,
          aadEnabled: true,
          azureRbacEnabled: true,
        });
        expect(await getKubeletIdentityObjectId(options)).toMatchObject({
          success: true,
          objectId: expect.stringMatching(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i),
        });
        expect(await getAksOidcIssuerUrl(options)).toMatchObject({
          success: true,
          issuerUrl: cluster.properties.oidcIssuerProfile?.issuerURL,
        });
        expect(command).not.toHaveBeenCalled();
      });
    });
  }
);
