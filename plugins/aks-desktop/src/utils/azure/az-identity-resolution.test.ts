// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueryResourceGraph = vi.fn();
const mockRunAzCommand = vi.fn();
const mockResourceGroupExists = vi.fn();
const mockCreateResourceGroup = vi.fn();
const mockAzRequest = vi.fn();
const mockAzListAll = vi.fn();
const mockGetAzureRoleTransport = vi.fn();
vi.mock('./az-cli-core', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-cli-core')>()),
  runAzCommand: (...args: unknown[]) => mockRunAzCommand(...args),
}));
vi.mock('./az-resource-graph', () => ({
  queryResourceGraph: (...args: unknown[]) => mockQueryResourceGraph(...args),
}));
vi.mock('./az-http', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-http')>()),
  azRequest: (...args: unknown[]) => mockAzRequest(...args),
  azListAll: (...args: unknown[]) => mockAzListAll(...args),
}));
vi.mock('./az-cloud', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-cloud')>()),
  getAzureCloudEndpoints: async () => ({
    endpoint: 'https://management.azure.com',
    scope: 'https://management.azure.com/.default',
  }),
}));
vi.mock('./az-role-assignments', () => ({
  createAzureRoleAssignment: vi.fn(),
  getAzureRoleTransport: (...args: unknown[]) => mockGetAzureRoleTransport(...args),
}));
vi.mock('./az-token', () => ({
  getSubscriptionCredential: () => ({ getToken: vi.fn() }),
}));
vi.mock('./az-subscriptions', () => ({
  resourceGroupExists: (...args: unknown[]) => mockResourceGroupExists(...args),
  createResourceGroup: (...args: unknown[]) => mockCreateResourceGroup(...args),
  getResourceGroupLocation: async () => 'eastus2',
}));

import { getManagedNamespaceResourceId, resolveManagedIdentityByClientId } from './az-identity';
import {
  createManagedIdentity,
  getManagedIdentity,
  listManagedIdentities,
} from './az-managed-identities';
import { ensureIdentityAndResourceGroup } from './identitySetup';

const subscriptionId = '11111111-2222-3333-4444-555555555555';
const clientId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('resolveManagedIdentityByClientId', () => {
  beforeEach(() => vi.resetAllMocks());

  it('resolves a saved client ID across resource groups within its subscription', async () => {
    mockQueryResourceGraph.mockResolvedValue([
      { name: 'custom-identity', resourceGroup: 'custom-rg', clientId },
    ]);
    await expect(resolveManagedIdentityByClientId({ subscriptionId, clientId })).resolves.toEqual({
      identityName: 'custom-identity',
      identityResourceGroup: 'custom-rg',
      clientId,
    });
    expect(mockQueryResourceGraph).toHaveBeenCalledWith(
      expect.stringContaining(`properties.clientId) =~ '${clientId}'`),
      [subscriptionId]
    );
  });

  it.each(['team.prod', 'rg(test)', 'équipe_资源١', '-rg'])(
    'resolves and revalidates the saved identity in %s without creating a replacement',
    async resourceGroup => {
      mockQueryResourceGraph.mockResolvedValue([
        { name: 'custom-identity', resourceGroup, clientId },
      ]);
      mockAzRequest.mockResolvedValue({
        properties: { clientId, principalId: subscriptionId, tenantId: subscriptionId },
      });

      const resolved = await resolveManagedIdentityByClientId({ subscriptionId, clientId });
      await expect(
        ensureIdentityAndResourceGroup({
          subscriptionId,
          resourceGroup: 'different-cluster-rg',
          ...resolved,
          existingClientId: clientId,
          onStatusChange: vi.fn(),
        })
      ).resolves.toMatchObject({ clientId, isExisting: true });

      expect(mockAzRequest).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ url: `${identityCollectionPath(resourceGroup)}/custom-identity` })
      );
      expect(mockRunAzCommand).not.toHaveBeenCalled();
      expect(mockResourceGroupExists).not.toHaveBeenCalled();
      expect(mockCreateResourceGroup).not.toHaveBeenCalled();
    }
  );

  it.each(
    [
      [],
      [{ name: 'identity', resourceGroup: 'rg', clientId: subscriptionId }],
      [{ name: 'identity', clientId }],
      [{ name: 'identity', resourceGroup: 'rg.', clientId }],
      [{ name: 'identity', resourceGroup: "rg' | take 1", clientId }],
      [{ name: 'identity.with.dots', resourceGroup: 'rg', clientId }],
      [
        { name: 'one', resourceGroup: 'rg', clientId },
        { name: 'two', resourceGroup: 'rg', clientId },
      ],
    ].map(rows => ({ rows }))
  )(
    'rejects missing, mismatched, malformed or ambiguous identity rows: $rows',
    async ({ rows }) => {
      mockQueryResourceGraph.mockResolvedValue(rows);
      await expect(resolveManagedIdentityByClientId({ subscriptionId, clientId })).rejects.toThrow(
        'No replacement was created'
      );
    }
  );

  it('preserves Azure authorization errors rather than guessing another identity', async () => {
    mockQueryResourceGraph.mockRejectedValue(new Error('403 Forbidden'));
    await expect(resolveManagedIdentityByClientId({ subscriptionId, clientId })).rejects.toThrow(
      '403 Forbidden'
    );
  });

  it('rejects invalid client IDs before constructing a Resource Graph query', async () => {
    await expect(
      resolveManagedIdentityByClientId({ subscriptionId, clientId: "' | take 1" })
    ).rejects.toThrow('Invalid');
    expect(mockQueryResourceGraph).not.toHaveBeenCalled();
  });
});

function identityCollectionPath(resourceGroup: string): string {
  return (
    `/subscriptions/${subscriptionId}/resourceGroups/${encodeURIComponent(resourceGroup)}` +
    '/providers/Microsoft.ManagedIdentity/userAssignedIdentities'
  );
}

describe.each([
  ['show identity', getManagedIdentity],
  ['create identity', createManagedIdentity],
  ['list identities', listManagedIdentities],
] as const)('%s resource group validation', (_label, operation) => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['team.prod', 'rg(test)', 'équipe_资源١', '-rg'])(
    'encodes resource group %s in the ARM path',
    async resourceGroup => {
      mockAzRequest.mockResolvedValue({
        properties: { clientId, principalId: subscriptionId, tenantId: subscriptionId },
      });
      mockAzListAll.mockResolvedValue([]);
      await expect(
        operation({
          subscriptionId,
          resourceGroup,
          identityName: 'custom-identity',
        })
      ).resolves.toMatchObject({ success: true });
      const path = identityCollectionPath(resourceGroup);
      if (operation === listManagedIdentities) {
        expect(mockAzListAll).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ url: path })
        );
      } else {
        expect(mockAzRequest).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ url: `${path}/custom-identity` })
        );
      }
      expect(mockRunAzCommand).not.toHaveBeenCalled();
    }
  );

  it.each(['rg.', 'rg/name', 'a'.repeat(91)])(
    'rejects invalid group %s before sending ARM requests',
    async resourceGroup => {
      await expect(
        operation({
          subscriptionId,
          resourceGroup,
          identityName: 'custom-identity',
        })
      ).resolves.toMatchObject({ success: false });
      expect(mockAzRequest).not.toHaveBeenCalled();
      expect(mockAzListAll).not.toHaveBeenCalled();
    }
  );
});

describe('getManagedNamespaceResourceId resource group arguments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetAzureRoleTransport.mockResolvedValue({
      endpoint: 'https://management.azure.com',
      scope: 'https://management.azure.com/.default',
    });
  });

  it.each(['team.prod', 'rg(test)', 'équipe_资源١', '-rg'])(
    'encodes resource group %s into the REST namespace path',
    async resourceGroup => {
      const expectedId = `/subscriptions/${subscriptionId}/resourceGroups/${encodeURIComponent(
        resourceGroup
      )}/providers/Microsoft.ContainerService/managedClusters/cluster/managedNamespaces/namespace`;
      mockAzRequest.mockResolvedValue({ id: expectedId });
      await expect(
        getManagedNamespaceResourceId({
          subscriptionId,
          resourceGroup,
          clusterName: 'cluster',
          namespaceName: 'namespace',
        })
      ).resolves.toEqual({ success: true, resourceId: expectedId });
      expect(mockAzRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expectedId,
          apiVersion: '2026-01-01',
        })
      );
      expect(mockRunAzCommand).not.toHaveBeenCalled();
    }
  );
});
