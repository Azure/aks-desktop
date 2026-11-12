// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResourceGroupExists = vi.fn();
const mockGetResourceGroupLocation = vi.fn();
const mockCreateResourceGroup = vi.fn();
const mockGetManagedIdentity = vi.fn();
const mockCreateManagedIdentity = vi.fn();
const mockAssignRolesToIdentity = vi.fn();
const mockCreateFederatedCredential = vi.fn();
const mockGetKubeletIdentityObjectId = vi.fn();
const mockResolveManagedIdentityByClientId = vi.fn();
const mockGetRegistryRoleAssignmentMode = vi.fn();

vi.mock('../../../utils/azure/az-acr', () => ({
  getRegistryRoleAssignmentMode: (...args: any[]) => mockGetRegistryRoleAssignmentMode(...args),
}));

vi.mock('../../../utils/azure/az-subscriptions', () => ({
  resourceGroupExists: (...args: any[]) => mockResourceGroupExists(...args),
  getResourceGroupLocation: (...args: any[]) => mockGetResourceGroupLocation(...args),
  createResourceGroup: (...args: any[]) => mockCreateResourceGroup(...args),
}));

vi.mock('../../../utils/azure/az-managed-identities', () => ({
  getManagedIdentity: (...args: any[]) => mockGetManagedIdentity(...args),
  createManagedIdentity: (...args: any[]) => mockCreateManagedIdentity(...args),
}));
vi.mock('../../../utils/azure/az-identity', () => ({
  resolveManagedIdentityByClientId: (...args: any[]) =>
    mockResolveManagedIdentityByClientId(...args),
  assignAzureRoles: (...args: any[]) => mockAssignRolesToIdentity(...args),
  getKubeletIdentityObjectId: (...args: any[]) => mockGetKubeletIdentityObjectId(...args),
  getManagedNamespaceResourceId: vi.fn(),
  buildClusterScope: (sub: string, rg: string, cluster: string) =>
    `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.ContainerService/managedClusters/${cluster}`,
}));

vi.mock('../../../utils/azure/az-federation', () => ({
  createFederatedCredential: (...args: any[]) => mockCreateFederatedCredential(...args),
}));

vi.mock('../../../utils/azure/identitySetup', async () => {
  const actual = await vi.importActual('../../../utils/azure/identitySetup');
  return actual;
});

vi.mock('../../../utils/azure/identityRoles', async () => {
  const actual = await vi.importActual('../../../utils/azure/identityRoles');
  return actual;
});

vi.mock('../../../utils/azure/identityWithRoles', async () => {
  const actual = await vi.importActual('../../../utils/azure/identityWithRoles');
  return actual;
});

import type { WorkloadIdentitySetupConfig } from './useWorkloadIdentitySetup';
import { getIdentityName, useWorkloadIdentitySetup } from './useWorkloadIdentitySetup';

const baseConfig: WorkloadIdentitySetupConfig = {
  subscriptionId: '12345678-1234-1234-1234-123456789abc',
  resourceGroup: 'cluster-rg',
  identityResourceGroup: 'rg-my-project',
  projectName: 'my-project',
  clusterName: 'my-cluster',
  repo: { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' },
  isManagedNamespace: false,
};

describe('getIdentityName', () => {
  it('derives identity name from project name', () => {
    expect(getIdentityName('my-project')).toBe('id-my-project-github');
  });

  it('handles empty string', () => {
    expect(getIdentityName('')).toBe('id-github');
  });
});

describe('useWorkloadIdentitySetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRegistryRoleAssignmentMode.mockResolvedValue('LegacyRegistryPermissions');
  });

  it('initializes with idle status', () => {
    const { result } = renderHook(() => useWorkloadIdentitySetup());

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it('rehydrates a custom-RG saved identity and revalidates the same client ID without creation', async () => {
    mockResolveManagedIdentityByClientId.mockResolvedValue({
      identityName: 'custom-identity',
      identityResourceGroup: 'custom-rg',
      clientId: 'saved-client',
    });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'saved-client',
      principalId: 'saved-principal',
      tenantId: 'tenant',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockGetKubeletIdentityObjectId.mockResolvedValue({ success: true, objectId: 'kubelet' });
    mockCreateFederatedCredential.mockResolvedValue({ success: true });
    const { result } = renderHook(() =>
      useWorkloadIdentitySetup('saved-registry-b', true, {
        subscriptionId: baseConfig.subscriptionId,
        clientId: 'saved-client',
      })
    );
    await act(async () => {});
    expect(result.current.existingIdentity?.identityResourceGroup).toBe('custom-rg');
    await act(async () =>
      result.current.setupWorkloadIdentity({
        ...baseConfig,
        acrResourceId: '/subscriptions/sub/registries/b',
      })
    );
    expect(result.current.status).toBe('done');
    expect(result.current.result?.clientId).toBe('saved-client');
    expect(mockGetManagedIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ identityName: 'custom-identity', resourceGroup: 'custom-rg' })
    );
    expect(mockCreateFederatedCredential).toHaveBeenCalledWith(
      expect.objectContaining({ identityName: 'custom-identity', resourceGroup: 'custom-rg' })
    );
    expect(mockAssignRolesToIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'saved-principal',
        roles: expect.arrayContaining([
          { role: 'AcrPush', scope: '/subscriptions/sub/registries/b' },
        ]),
      })
    );
  });

  it('revalidates a saved identity when the default branch contains a slash', async () => {
    mockResolveManagedIdentityByClientId.mockResolvedValue({
      identityName: 'custom-identity',
      identityResourceGroup: 'custom-rg',
      clientId: 'saved-client',
    });
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'saved-client',
      principalId: 'saved-principal',
      tenantId: 'saved-tenant',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockGetKubeletIdentityObjectId.mockResolvedValue({ success: true, objectId: 'kubelet-oid' });
    mockCreateFederatedCredential.mockResolvedValue({ success: true });

    const { result } = renderHook(() =>
      useWorkloadIdentitySetup('scope', true, {
        clientId: 'saved-client',
        subscriptionId: baseConfig.subscriptionId,
      })
    );
    await act(async () =>
      result.current.setupWorkloadIdentity({
        ...baseConfig,
        repo: { ...baseConfig.repo, defaultBranch: 'release/deploy' },
      })
    );
    expect(result.current.status).toBe('done');
    expect(mockCreateFederatedCredential).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'release/deploy' })
    );
    expect(mockResourceGroupExists).not.toHaveBeenCalled();
    expect(mockCreateResourceGroup).not.toHaveBeenCalled();
    expect(mockCreateManagedIdentity).not.toHaveBeenCalled();
  });

  it('surfaces saved identity lookup failure and never grants to or creates a replacement', async () => {
    mockResolveManagedIdentityByClientId.mockRejectedValue(new Error('Forbidden identity lookup'));
    const { result } = renderHook(() =>
      useWorkloadIdentitySetup('saved', true, {
        subscriptionId: baseConfig.subscriptionId,
        clientId: 'saved-client',
      })
    );
    await act(async () => {});
    expect(result.current.identityResolutionError).toContain('Forbidden identity lookup');
    await act(async () => result.current.setupWorkloadIdentity(baseConfig));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Forbidden identity lookup');
    expect(mockCreateManagedIdentity).not.toHaveBeenCalled();
    expect(mockAssignRolesToIdentity).not.toHaveBeenCalled();
    expect(mockCreateFederatedCredential).not.toHaveBeenCalled();
  });

  it('requires explicit manual acknowledgement for a positively identified service-principal cluster', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockGetKubeletIdentityObjectId.mockResolvedValue({
      success: false,
      servicePrincipalRequiresManualVerification: true,
    });
    mockCreateFederatedCredential.mockResolvedValue({ success: true });
    const config = { ...baseConfig, acrResourceId: '/subscriptions/sub/registries/a' };
    const { result, rerender } = renderHook(({ scope }) => useWorkloadIdentitySetup(scope, true), {
      initialProps: { scope: 'registry-a' },
    });
    await act(async () => result.current.setupWorkloadIdentity(config));
    expect(result.current.status).toBe('error');
    expect(result.current.servicePrincipalPullRequired).toBe(true);
    expect(result.current.result).toBeNull();
    await act(async () =>
      result.current.setupWorkloadIdentity({ ...config, acknowledgeServicePrincipalPull: true })
    );
    expect(result.current.status).toBe('done');
    expect(result.current.result?.servicePrincipalPullAcknowledged).toBe(true);
    expect(mockAssignRolesToIdentity.mock.calls.every(([call]) => call.principalId === 'pid')).toBe(
      true
    );
    rerender({ scope: 'registry-b' });
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(result.current.servicePrincipalPullRequired).toBe(false);
  });

  it('revalidates identity build roles and kubelet pull permission for a changed registry', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockGetKubeletIdentityObjectId.mockResolvedValue({ success: true, objectId: 'kubelet' });
    mockCreateFederatedCredential.mockResolvedValue({ success: true });
    const registryA =
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/a';
    const registryB = registryA.replace('/a', '/b');
    const { result, rerender } = renderHook(
      ({ registry }) => useWorkloadIdentitySetup(registry, true),
      { initialProps: { registry: registryA } }
    );
    await act(async () =>
      result.current.setupWorkloadIdentity({ ...baseConfig, acrResourceId: registryA })
    );
    expect(result.current.status).toBe('done');
    rerender({ registry: registryB });
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(mockAssignRolesToIdentity).toHaveBeenCalledTimes(2);

    let finishIdentityRoles!: (value: object) => void;
    let finishKubeletRole!: (value: object) => void;
    mockAssignRolesToIdentity
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishIdentityRoles = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishKubeletRole = resolve;
          })
      );
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.setupWorkloadIdentity({ ...baseConfig, acrResourceId: registryB });
    });
    expect(result.current.status).toBe('assigning-roles');
    expect(mockAssignRolesToIdentity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        principalId: 'pid',
        roles: expect.arrayContaining([
          { role: 'AcrPush', scope: registryB },
          { role: 'Container Registry Tasks Contributor', scope: registryB },
        ]),
      })
    );
    await act(async () => finishIdentityRoles({ success: true, results: [] }));
    expect(result.current.status).not.toBe('done');
    expect(mockAssignRolesToIdentity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        principalId: 'kubelet',
        roles: [{ role: 'AcrPull', scope: registryB }],
      })
    );
    await act(async () => {
      finishKubeletRole({ success: true, results: [] });
      await pending;
    });
    expect(result.current.status).toBe('done');
  });

  it.each([false, true])(
    'keeps strict pipeline setup blocked on kubelet errors even with manual acknowledgement=%s',
    async acknowledgeServicePrincipalPull => {
      mockResourceGroupExists.mockResolvedValue({ exists: true });
      mockGetManagedIdentity.mockResolvedValue({
        success: true,
        clientId: 'cid',
        principalId: 'pid',
        tenantId: 'tid',
      });
      mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
      mockGetKubeletIdentityObjectId.mockResolvedValue({ success: false, error: 'Forbidden' });
      mockCreateFederatedCredential.mockResolvedValue({ success: true });
      const { result } = renderHook(() => useWorkloadIdentitySetup('registry-b', true));
      await act(async () =>
        result.current.setupWorkloadIdentity({
          ...baseConfig,
          acrResourceId: '/subscriptions/sub/registries/b',
          acknowledgeServicePrincipalPull,
        })
      );
      expect(result.current.status).toBe('error');
      expect(result.current.error).toContain('Could not resolve kubelet identity: Forbidden');
      expect(result.current.result).toBeNull();
      expect(result.current.servicePrincipalPullRequired).toBe(false);
    }
  );

  it('ignores a previous registry setup completing after the scope changes', async () => {
    let finishLookup!: (value: object) => void;
    mockResourceGroupExists.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishLookup = resolve;
        })
    );
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'old',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    const { result, rerender } = renderHook(
      ({ registry }) => useWorkloadIdentitySetup(registry, true),
      { initialProps: { registry: 'a' } }
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.setupWorkloadIdentity(baseConfig);
    });
    rerender({ registry: 'b' });
    await act(async () => {
      finishLookup({ exists: true });
      await pending;
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
  });

  it('skips RG creation when RG already exists', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockCreateFederatedCredential.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useWorkloadIdentitySetup());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(mockResourceGroupExists).toHaveBeenCalledWith({
      resourceGroupName: 'rg-my-project',
      subscriptionId: baseConfig.subscriptionId,
    });
    expect(mockGetResourceGroupLocation).not.toHaveBeenCalled();
    expect(mockCreateResourceGroup).not.toHaveBeenCalled();
    expect(result.current.status).toBe('done');
  });

  it('creates RG when it does not exist', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: false });
    mockGetResourceGroupLocation.mockResolvedValue('eastus');
    mockCreateResourceGroup.mockResolvedValue({ success: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockCreateFederatedCredential.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useWorkloadIdentitySetup());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(mockGetResourceGroupLocation).toHaveBeenCalledWith({
      resourceGroupName: 'cluster-rg',
      subscriptionId: baseConfig.subscriptionId,
    });
    expect(mockCreateResourceGroup).toHaveBeenCalledWith({
      resourceGroupName: 'rg-my-project',
      location: 'eastus',
      subscriptionId: baseConfig.subscriptionId,
      tags: ['purpose=GitHub Actions Identity', 'createdBy=AKS Desktop'],
    });
    expect(result.current.status).toBe('done');
  });

  it('uses identityResourceGroup for identity and credential operations', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: false,
      notFound: true,
    });
    mockCreateManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockCreateFederatedCredential.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useWorkloadIdentitySetup());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    // Identity lookup uses identityResourceGroup
    expect(mockGetManagedIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ resourceGroup: 'rg-my-project' })
    );
    // Identity creation uses identityResourceGroup
    expect(mockCreateManagedIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ resourceGroup: 'rg-my-project' })
    );
    // Role assignment is called with the principalId
    expect(mockAssignRolesToIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'pid' })
    );
    // Federated credential uses identityResourceGroup
    expect(mockCreateFederatedCredential).toHaveBeenCalledWith(
      expect.objectContaining({ resourceGroup: 'rg-my-project' })
    );
    expect(result.current.status).toBe('done');
  });

  it('sets error when RG existence check fails', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: false, error: 'Network timeout' });

    const { result } = renderHook(() => useWorkloadIdentitySetup());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Network timeout');
    expect(mockGetResourceGroupLocation).not.toHaveBeenCalled();
    expect(mockCreateResourceGroup).not.toHaveBeenCalled();
  });

  it('sets error status when RG creation fails', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: false });
    mockGetResourceGroupLocation.mockResolvedValue('eastus');
    mockCreateResourceGroup.mockResolvedValue({
      success: false,
      error: 'Permission denied',
    });

    const { result } = renderHook(() => useWorkloadIdentitySetup());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Permission denied');
  });

  it('reuses existing identity when found', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'existing-cid',
      principalId: 'existing-pid',
      tenantId: 'existing-tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockCreateFederatedCredential.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useWorkloadIdentitySetup());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(mockCreateManagedIdentity).not.toHaveBeenCalled();
    expect(result.current.result).toEqual(
      expect.objectContaining({
        clientId: 'existing-cid',
        isExisting: true,
        identityName: 'id-my-project-github',
      })
    );
  });

  it('throws on real identity lookup error (not notFound)', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: false,
      notFound: false,
      error: 'Network timeout',
    });

    const { result } = renderHook(() => useWorkloadIdentitySetup());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Network timeout');
  });

  it('sets error when role assignment fails', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({
      success: false,
      results: [{ role: 'AKS Cluster User', scope: '/sub', success: false, error: 'Forbidden' }],
    });

    const { result } = renderHook(() => useWorkloadIdentitySetup());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Forbidden');
  });

  it('sets error when federated credential creation fails', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockCreateFederatedCredential.mockResolvedValue({
      success: false,
      error: 'Credential already exists',
    });

    const { result } = renderHook(() => useWorkloadIdentitySetup());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Credential already exists');
  });
});
