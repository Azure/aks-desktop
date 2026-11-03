// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { type AzureLiveAuthBridge, createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getAzureCloudEndpoints } from './az-cloud';
import { azListAll, azRequest } from './az-http';
import { assignAzureRoles } from './az-identity';
import { type AzureRoleAssignment, createAzureRoleAssignment } from './az-role-assignments';
import { getSubscriptionCredential } from './az-token';

describe.runIf(azureLiveEnabled)(
  'role-assignment REST E2E',
  { timeout: AZURE_LIVE_TEST_TIMEOUT },
  () => {
    let context: ReturnType<typeof getLiveAzureContext>;
    let bridge: AzureLiveAuthBridge;
    let cloud: Awaited<ReturnType<typeof getAzureCloudEndpoints>>;
    beforeAll(async () => {
      context = getLiveAzureContext();
      bridge = createAzureLiveAuthBridge(context.subscriptionId);
      vi.stubGlobal('pluginRunCommand', bridge.runCommand);
      getSubscriptionCredential(context.subscriptionId).clearCache();
      cloud = await getAzureCloudEndpoints();
      expect(cloud.endpoint).toBe('https://management.azure.com');
    }, 70_000);
    afterAll(() => vi.unstubAllGlobals());

    test('assigns roles idempotently and verifies a real existing-assignment conflict', async () => {
      await withAzureTestResourceGroup('role-assignment', context, async run => {
        const identityId = `${run.resourceGroupId}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/test-identity`;
        const identity = await azRequest<{ properties?: { principalId?: string } }>({
          ...run,
          url: identityId,
          method: 'PUT',
          apiVersion: '2023-01-31',
          body: { location: run.location, tags: run.tags },
        });
        const principalId = identity?.properties?.principalId;
        if (!principalId) throw new Error('Test identity response is missing principalId');
        const authentication = { subscriptionId: run.subscriptionId, tenantId: run.tenantId };
        /**
         * @param scope - Exact owned resource scope, never an inherited parent.
         * @param expectedId - Optional seeded assignment ID that must become visible.
         * @returns Exact-principal/scope assignments after observed propagation.
         * @throws If the expected grant remains absent after five minutes.
         */
        const observedAssignments = async (scope: string, expectedId?: string) => {
          const visibleBy = Date.now() + 5 * 60_000;
          for (;;) {
            const assignments = await azListAll<AzureRoleAssignment>({
              ...run,
              ...cloud,
              credential: getSubscriptionCredential(run.subscriptionId),
              url: `${scope}/providers/Microsoft.Authorization/roleAssignments?$filter=principalId%20eq%20%27${principalId}%27`,
              apiVersion: '2022-04-01',
            });
            const exact = assignments.filter(
              item =>
                item.properties?.principalId === principalId &&
                item.properties.scope?.toLowerCase() === scope.toLowerCase()
            );
            if (
              exact.length > 0 &&
              (!expectedId ||
                exact.some(item => item.id?.toLowerCase() === expectedId.toLowerCase()))
            ) {
              return exact;
            }
            if (Date.now() >= visibleBy) {
              throw new Error('Role assignment did not become visible before the setup deadline');
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        };
        for (let attempt = 0; attempt < 2; attempt++) {
          expect(
            await assignAzureRoles({
              ...authentication,
              principalId,
              principalType: 'ServicePrincipal',
              roles: [{ role: 'Reader', scope: run.resourceGroupId }],
            })
          ).toMatchObject({ success: true, results: [{ success: true }] });
        }
        const matches = await observedAssignments(run.resourceGroupId);
        expect(matches).toHaveLength(1);
        expect(matches[0].properties).toMatchObject({
          principalType: 'ServicePrincipal',
          roleDefinitionId: expect.stringContaining('acdd72a7-3385-48ef-bd42-f606fba81ae7'),
        });
        console.info('Verified production credential reuse and the exact group-scope Reader grant');
        const seededId = `${identityId}/providers/Microsoft.Authorization/roleAssignments/${randomUUID()}`;
        await azRequest({
          ...run,
          url: seededId,
          method: 'PUT',
          apiVersion: '2022-04-01',
          body: {
            properties: {
              principalId,
              principalType: 'ServicePrincipal',
              roleDefinitionId: `/subscriptions/${run.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7`,
            },
          },
        });
        const seeded = await azRequest<AzureRoleAssignment>({
          ...run,
          url: seededId,
          apiVersion: '2022-04-01',
        });
        expect(seeded?.properties?.scope?.toLowerCase()).toBe(identityId.toLowerCase());
        await observedAssignments(identityId, seededId);
        const definitions = await azListAll<{ id?: string; properties?: { roleName?: string } }>({
          ...run,
          ...cloud,
          credential: getSubscriptionCredential(run.subscriptionId),
          url: `${identityId}/providers/Microsoft.Authorization/roleDefinitions?$filter=roleName%20eq%20%27Reader%27`,
          apiVersion: '2022-04-01',
        });
        expect(definitions).toHaveLength(1);
        expect(definitions[0].properties?.roleName).toBe('Reader');
        expect(definitions[0].id?.toLowerCase()).toBe(
          `/subscriptions/${run.subscriptionId}/providers/microsoft.authorization/roledefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7`.toLowerCase()
        );
        const existing = await createAzureRoleAssignment({
          ...authentication,
          scope: identityId,
          principalId,
          principalType: 'ServicePrincipal',
          role: 'Reader',
        });
        expect(existing?.id?.toLowerCase()).toBe(seededId.toLowerCase());
        expect(existing?.properties).toMatchObject({
          principalId,
          principalType: 'ServicePrincipal',
        });
        expect(existing?.properties?.scope?.toLowerCase()).toBe(identityId.toLowerCase());
        expect(await observedAssignments(identityId, seededId)).toHaveLength(1);
        expect(bridge.tokenRequests).toBe(1);
        expect(bridge.cloudReads).toBe(1);
      });
    });
  }
);
