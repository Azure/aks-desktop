// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { createContainerRegistry, getContainerRegistries } from './az-acr';
import { clearAzureCloudCache } from './az-cloud';
import { getSubscriptionCredential } from './az-token';

describe.runIf(azureLiveEnabled)(
  'ACR registry REST E2E',
  { timeout: AZURE_LIVE_TEST_TIMEOUT },
  () => {
    let context: ReturnType<typeof getLiveAzureContext>;

    beforeAll(() => {
      context = getLiveAzureContext();
      const bridge = createAzureLiveAuthBridge(context.subscriptionId);
      vi.stubGlobal('pluginRunCommand', bridge.runCommand);
      clearAzureCloudCache();
      getSubscriptionCredential(context.subscriptionId).clearCache();
    }, 70_000);
    afterAll(() => {
      vi.unstubAllGlobals();
      clearAzureCloudCache();
      if (context) getSubscriptionCredential(context.subscriptionId).clearCache();
    });

    test('creates a run-owned registry and finds it in the subscription listing', async () => {
      await withAzureTestResourceGroup('acr', context, async run => {
        const registryName = `aksd${run.runId.replace(/[^a-z0-9]/g, '')}`;
        const created = await createContainerRegistry({
          registryName,
          resourceGroup: run.resourceGroup,
          subscriptionId: run.subscriptionId,
          location: run.location,
          sku: 'Basic',
        });

        expect(created.success).toBe(true);
        expect(created.id?.toLowerCase()).toContain(
          `/resourcegroups/${run.resourceGroup}/providers/microsoft.containerregistry/registries/${registryName}`
        );
        expect(created.loginServer).toBe(`${registryName}.azurecr.io`);

        const registries = await getContainerRegistries(run.subscriptionId);
        expect(registries).toContainEqual(
          expect.objectContaining({
            id: created.id,
            name: registryName,
            resourceGroup: run.resourceGroup,
            loginServer: created.loginServer,
            location: run.location,
            sku: 'Basic',
          })
        );
      });
    });
  }
);
