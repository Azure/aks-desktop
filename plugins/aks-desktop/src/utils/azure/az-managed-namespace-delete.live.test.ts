// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createLiveAksCluster } from '../test/azureLiveAksTestUtils';
import { getLiveNamespaceReader } from '../test/azureLiveKubernetesTestUtils';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { azRequest } from './az-http';
import { deleteManagedNamespace } from './az-namespaces';

describe.runIf(azureLiveEnabled)(
  'managed namespace deletion REST E2E',
  { timeout: AZURE_LIVE_TEST_TIMEOUT + 30 * 60_000 },
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

    test('observes deletion, honors Keep/Delete and preserves a retained Kubernetes namespace', async () => {
      await withAzureTestResourceGroup('namespace-delete', context, async run => {
        const cluster = await createLiveAksCluster(run);
        const readNamespace = await getLiveNamespaceReader(cluster);
        for (const deletePolicy of ['Keep', 'Delete'] as const) {
          const namespaceName = `rest-e2e-${deletePolicy.toLowerCase()}`;
          const url = `${run.resourceGroupId}/providers/Microsoft.ContainerService/managedClusters/aks/managedNamespaces/${namespaceName}`;
          await azRequest({
            ...run,
            url,
            method: 'PUT',
            apiVersion: '2026-01-01',
            body: {
              location: run.location,
              tags: run.tags,
              properties: {
                deletePolicy,
                adoptionPolicy: 'IfIdentical',
                defaultResourceQuota: {
                  cpuRequest: '500m',
                  cpuLimit: '1000m',
                  memoryRequest: '512Mi',
                  memoryLimit: '1Gi',
                },
                labels: { 'aks-desktop-test-run': run.runId },
                defaultNetworkPolicy: { ingress: 'AllowAll', egress: 'AllowAll' },
              },
            },
          });
          const deadline = Date.now() + 5 * 60_000;
          for (;;) {
            const resource = await azRequest<{ properties?: { provisioningState?: string } }>({
              ...run,
              url,
              apiVersion: '2026-01-01',
            });
            const state = resource?.properties?.provisioningState;
            if (state === 'Succeeded') break;
            if (state === 'Failed' || Date.now() >= deadline) {
              throw new Error(`Test namespace creation failed or timed out: ${state}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          expect((await readNamespace(namespaceName))?.metadata?.name).toBe(namespaceName);
          console.info(
            `Checking managed namespace ${namespaceName} with ${deletePolicy} retention`
          );
          const deletion = await deleteManagedNamespace({ ...cluster, namespaceName });
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
          const repeated = await deleteManagedNamespace({ ...cluster, namespaceName });
          expect(repeated.error).toBeUndefined();
          expect(repeated.success).toBe(true);
          console.info(`Verified ${deletePolicy} retention for ${namespaceName}`);
        }
        expect(command).not.toHaveBeenCalled();
      });
    });
  }
);
