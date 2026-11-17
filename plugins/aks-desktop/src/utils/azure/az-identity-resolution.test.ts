// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueryResourceGraph = vi.fn();
const mockRunAzCommand = vi.fn();
const mockResourceGroupExists = vi.fn();
const mockCreateResourceGroup = vi.fn();
const mockAzRequest = vi.fn();
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
  getResourceGroupLocation: vi.fn(),
}));

import {
  createManagedIdentity,
  getManagedIdentity,
  getManagedNamespaceResourceId,
  listManagedIdentities,
  resolveManagedIdentityByClientId,
} from './az-identity';
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
      mockRunAzCommand.mockResolvedValue({
        success: true,
        data: { clientId, principalId: subscriptionId, tenantId: subscriptionId },
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

      expect(mockRunAzCommand).toHaveBeenCalledTimes(1);
      expect(mockRunAzCommand.mock.calls[0][0]).toEqual([
        'identity',
        'show',
        '--name',
        'custom-identity',
        `--resource-group=${resourceGroup}`,
        '--subscription',
        subscriptionId,
        '--output',
        'json',
      ]);
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

describe.each([
  ['show identity', getManagedIdentity],
  ['create identity', createManagedIdentity],
  ['list identities', listManagedIdentities],
] as const)('%s resource group validation', (_label, operation) => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['team.prod', 'rg(test)', 'équipe_资源١', '-rg'])(
    'passes the target resource group %s unchanged',
    async resourceGroup => {
      mockRunAzCommand.mockResolvedValue({
        success: true,
        data: { identityProfile: { kubeletidentity: { objectId: clientId } } },
      });
      await expect(
        operation({
          subscriptionId,
          resourceGroup,
          identityName: 'custom-identity',
        })
      ).resolves.toMatchObject({ success: true });
      expect(mockRunAzCommand).toHaveBeenCalledTimes(1);
      const args = mockRunAzCommand.mock.calls[0][0];
      expect(args).toContain(`--resource-group=${resourceGroup}`);
      expect(args).not.toContain('--resource-group');
      expect(args).not.toContain(resourceGroup);
    }
  );

  it.each(['rg.', 'rg/name', 'a'.repeat(91)])(
    'rejects invalid group %s before CLI calls',
    async resourceGroup => {
      await expect(
        operation({
          subscriptionId,
          resourceGroup,
          identityName: 'custom-identity',
        })
      ).resolves.toMatchObject({ success: false });
      expect(mockRunAzCommand).not.toHaveBeenCalled();
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
