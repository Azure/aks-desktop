// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { azListAll, azRequest } from './az-http';
import { assignAzureRoles } from './az-identity';
import type { AzureRoleAssignment } from './az-role-assignments';

describe.runIf(azureLiveEnabled)(
  'role-assignment REST E2E',
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

    test('assigns a role idempotently to a new run-owned identity and removes all resources', async () => {
      await withAzureTestResourceGroup('role-assignment', context, async run => {
        const identity = await azRequest<{ properties?: { principalId?: string } }>({
          ...run,
          url: `${run.resourceGroupId}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/test-identity`,
          method: 'PUT',
          apiVersion: '2023-01-31',
          body: { location: run.location, tags: run.tags },
        });
        const principalId = identity?.properties?.principalId;
        if (!principalId) throw new Error('Test identity response is missing principalId');
        for (let attempt = 0; attempt < 2; attempt++) {
          expect(
            await assignAzureRoles({
              ...run,
              principalId,
              principalType: 'ServicePrincipal',
              roles: [{ role: 'Reader', scope: run.resourceGroupId }],
            })
          ).toMatchObject({ success: true, results: [{ success: true }] });
        }
        const assignments = await azListAll<AzureRoleAssignment>({
          ...run,
          url: `${run.resourceGroupId}/providers/Microsoft.Authorization/roleAssignments?$filter=principalId%20eq%20%27${principalId}%27`,
          apiVersion: '2022-04-01',
        });
        const matches = assignments.filter(
          item =>
            item.properties?.principalId === principalId &&
            item.properties.scope?.toLowerCase() === run.resourceGroupId.toLowerCase()
        );
        expect(matches).toHaveLength(1);
        expect(matches[0].properties).toMatchObject({
          principalType: 'ServicePrincipal',
          roleDefinitionId: expect.stringContaining('acdd72a7-3385-48ef-bd42-f606fba81ae7'),
        });
        expect(command).not.toHaveBeenCalled();
      });
    });
  }
);
