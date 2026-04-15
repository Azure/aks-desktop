// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResourceGroupExists = vi.fn();
const mockGetResourceGroupLocation = vi.fn();
const mockCreateResourceGroup = vi.fn();
const mockGetManagedIdentity = vi.fn();
const mockCreateManagedIdentity = vi.fn();
const mockAssignRolesToIdentity = vi.fn();
const mockGetManagedNamespaceResourceId = vi.fn();
const mockGetKubeletIdentityObjectId = vi.fn();

vi.mock('./az-subscriptions', () => ({
  resourceGroupExists: (...args: any[]) => mockResourceGroupExists(...args),
  getResourceGroupLocation: (...args: any[]) => mockGetResourceGroupLocation(...args),
  createResourceGroup: (...args: any[]) => mockCreateResourceGroup(...args),
}));

vi.mock('./az-identity', () => ({
  getManagedIdentity: (...args: any[]) => mockGetManagedIdentity(...args),
  createManagedIdentity: (...args: any[]) => mockCreateManagedIdentity(...args),
  assignRolesToIdentity: (...args: any[]) => mockAssignRolesToIdentity(...args),
  getManagedNamespaceResourceId: (...args: any[]) => mockGetManagedNamespaceResourceId(...args),
  getKubeletIdentityObjectId: (...args: any[]) => mockGetKubeletIdentityObjectId(...args),
  buildClusterScope: (sub: string, rg: string, cluster: string) =>
    `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.ContainerService/managedClusters/${cluster}`,
}));

vi.mock('./identitySetup', async () => {
  const actual = await vi.importActual('./identitySetup');
  return actual;
});

vi.mock('./identityRoles', async () => {
  const actual = await vi.importActual('./identityRoles');
  return actual;
});

import { ensureIdentityWithRoles, type EnsureIdentityWithRolesConfig } from './identityWithRoles';

const baseConfig: EnsureIdentityWithRolesConfig = {
  subscriptionId: '12345678-1234-1234-1234-123456789abc',
  resourceGroup: 'cluster-rg',
  identityResourceGroup: 'identity-rg',
  identityName: 'id-my-app-workload',
  clusterName: 'my-cluster',
  isManagedNamespace: false,
  onStatusChange: vi.fn(),
};

function setupHappyPath() {
  mockResourceGroupExists.mockResolvedValue({ exists: true });
  mockGetManagedIdentity.mockResolvedValue({
    success: true,
    clientId: 'cid',
    principalId: 'pid',
    tenantId: 'tid',
  });
  mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
}

describe('ensureIdentityWithRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns identity after ensuring RG, identity, and roles (normal namespace)', async () => {
    setupHappyPath();

    const result = await ensureIdentityWithRoles(baseConfig);

    expect(result).toEqual({
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
      isExisting: true,
      warnings: [],
    });
    expect(mockAssignRolesToIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'pid' })
    );
  });

  it('creates RG and identity when they do not exist', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: false });
    mockGetResourceGroupLocation.mockResolvedValue('eastus');
    mockCreateResourceGroup.mockResolvedValue({ success: true });
    mockGetManagedIdentity.mockResolvedValue({ success: false, notFound: true });
    mockCreateManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'new-cid',
      principalId: 'new-pid',
      tenantId: 'new-tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });

    const result = await ensureIdentityWithRoles(baseConfig);

    expect(result.clientId).toBe('new-cid');
    expect(result.isExisting).toBe(false);
    expect(mockCreateResourceGroup).toHaveBeenCalled();
    expect(mockCreateManagedIdentity).toHaveBeenCalled();
  });

  it('calls getManagedNamespaceResourceId for managed namespaces', async () => {
    setupHappyPath();
    mockGetManagedNamespaceResourceId.mockResolvedValue({
      success: true,
      resourceId: '/subscriptions/sub/resourceGroups/rg/providers/.../managedNamespaces/my-ns',
    });

    await ensureIdentityWithRoles({
      ...baseConfig,
      isManagedNamespace: true,
      namespaceName: 'my-ns',
    });

    expect(mockGetManagedNamespaceResourceId).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: 'my-ns' })
    );
    // Roles should include MNS-scoped roles, not cluster-scoped
    const roleCall = mockAssignRolesToIdentity.mock.calls[0][0];
    const roleNames = roleCall.roles.map((r: { role: string }) => r.role);
    expect(roleNames).toContain('Azure Kubernetes Service RBAC Writer');
    expect(roleNames).toContain('Azure Kubernetes Service Namespace User');
    expect(roleNames).not.toContain('Azure Kubernetes Service Cluster User Role');
  });

  it('throws when isManagedNamespace is true but namespaceName is missing', async () => {
    await expect(
      ensureIdentityWithRoles({
        ...baseConfig,
        isManagedNamespace: true,
      })
    ).rejects.toThrow('namespaceName is required when isManagedNamespace is true');

    // Should fail before any Azure calls
    expect(mockResourceGroupExists).not.toHaveBeenCalled();
  });

  it('throws when managed namespace resource ID lookup fails', async () => {
    setupHappyPath();
    mockGetManagedNamespaceResourceId.mockResolvedValue({
      success: false,
      error: 'Namespace not found',
    });

    await expect(
      ensureIdentityWithRoles({
        ...baseConfig,
        isManagedNamespace: true,
        namespaceName: 'bad-ns',
      })
    ).rejects.toThrow('Namespace not found');
  });

  it('throws with failed role details when role assignment fails', async () => {
    setupHappyPath();
    mockAssignRolesToIdentity.mockResolvedValue({
      success: false,
      results: [
        { role: 'AKS Cluster User', scope: '/sub', success: false, error: 'Forbidden' },
        { role: 'AcrPush', scope: '/acr', success: true },
      ],
    });

    await expect(ensureIdentityWithRoles(baseConfig)).rejects.toThrow(
      'Failed to assign roles: AKS Cluster User: Forbidden'
    );
  });

  it('includes ACR roles when acrResourceId is provided', async () => {
    setupHappyPath();

    await ensureIdentityWithRoles({
      ...baseConfig,
      acrResourceId: '/subscriptions/sub/resourceGroups/rg/providers/.../registries/myacr',
    });

    const roleCall = mockAssignRolesToIdentity.mock.calls[0][0];
    const roleNames = roleCall.roles.map((r: { role: string }) => r.role);
    expect(roleNames).toContain('AcrPush');
    expect(roleNames).toContain('Container Registry Tasks Contributor');
  });

  it('reports status changes in correct sequence', async () => {
    setupHappyPath();
    const onStatusChange = vi.fn();

    await ensureIdentityWithRoles({ ...baseConfig, onStatusChange });

    const calls = onStatusChange.mock.calls.map(c => c[0]);
    expect(calls).toContain('creating-rg');
    expect(calls).toContain('checking');
    expect(calls).toContain('assigning-roles');
    // assigning-roles should come after identity setup statuses
    const assignIdx = calls.indexOf('assigning-roles');
    expect(assignIdx).toBeGreaterThan(0);
  });

  it('throws when RG creation fails', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: false });
    mockGetResourceGroupLocation.mockResolvedValue('eastus');
    mockCreateResourceGroup.mockResolvedValue({ success: false, error: 'Permission denied' });

    await expect(ensureIdentityWithRoles(baseConfig)).rejects.toThrow('Permission denied');
  });

  it('should assign AcrPull to kubelet identity when ACR is provided', async () => {
    setupHappyPath();
    mockGetKubeletIdentityObjectId.mockResolvedValue({
      success: true,
      objectId: 'kubelet-principal-1',
    });

    const result = await ensureIdentityWithRoles({
      ...baseConfig,
      subscriptionId: 'sub-1',
      resourceGroup: 'rg-1',
      identityResourceGroup: 'id-rg',
      identityName: 'id-1',
      clusterName: 'aks-1',
      acrResourceId:
        '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/myacr',
      isManagedNamespace: false,
      isPipeline: true,
      onStatusChange: vi.fn(),
    });

    // Second call to assignRolesToIdentity is for kubelet AcrPull
    // subscriptionId is extracted from the ACR resource ID to support cross-subscription ACR
    expect(mockAssignRolesToIdentity).toHaveBeenCalledTimes(2);
    expect(mockAssignRolesToIdentity).toHaveBeenLastCalledWith({
      principalId: 'kubelet-principal-1',
      subscriptionId: 'sub',
      roles: [
        {
          role: 'AcrPull',
          scope:
            '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/myacr',
        },
      ],
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('should still return identity with warning when getKubeletIdentityObjectId fails', async () => {
    setupHappyPath();
    mockGetKubeletIdentityObjectId.mockResolvedValue({
      success: false,
      error: 'Cluster not found',
    });
    const onStatusChange = vi.fn();

    const result = await ensureIdentityWithRoles({
      ...baseConfig,
      acrResourceId:
        '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/myacr',
      isPipeline: true,
      onStatusChange,
    });

    expect(result).toBeDefined();
    expect(result.clientId).toBe('cid');
    // Should include a warning about kubelet identity
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('kubelet identity');
    // Should not emit warning via onStatusChange
    expect(onStatusChange).not.toHaveBeenCalledWith('warning-kubelet-acr-pull');
    // Should not attempt kubelet role assignment
    expect(mockAssignRolesToIdentity).toHaveBeenCalledTimes(1);
  });

  it('should still return identity with warning when kubelet AcrPull assignment fails', async () => {
    setupHappyPath();
    mockGetKubeletIdentityObjectId.mockResolvedValue({
      success: true,
      objectId: 'kubelet-principal-1',
    });
    // First call succeeds (identity roles), second call fails (kubelet AcrPull)
    mockAssignRolesToIdentity
      .mockResolvedValueOnce({ success: true, results: [] })
      .mockResolvedValueOnce({ success: false, error: 'Forbidden' });
    const onStatusChange = vi.fn();

    const result = await ensureIdentityWithRoles({
      ...baseConfig,
      acrResourceId:
        '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/myacr',
      isPipeline: true,
      onStatusChange,
    });

    expect(result).toBeDefined();
    expect(result.clientId).toBe('cid');
    // Should include a warning about AcrPull failure
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('AcrPull');
    // Should include the underlying error detail
    expect(result.warnings[0]).toContain('Forbidden');
    // Should not emit warning via onStatusChange
    expect(onStatusChange).not.toHaveBeenCalledWith('warning-kubelet-acr-pull');
  });

  it('should skip kubelet AcrPull when isPipeline is true but acrResourceId is missing', async () => {
    setupHappyPath();

    const result = await ensureIdentityWithRoles({
      ...baseConfig,
      isPipeline: true,
    });

    expect(mockGetKubeletIdentityObjectId).not.toHaveBeenCalled();
    // Only the identity role assignment call
    expect(mockAssignRolesToIdentity).toHaveBeenCalledTimes(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('should skip kubelet AcrPull when acrResourceId is set but isPipeline is false', async () => {
    setupHappyPath();

    const result = await ensureIdentityWithRoles({
      ...baseConfig,
      acrResourceId:
        '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/myacr',
      isPipeline: false,
    });

    expect(mockGetKubeletIdentityObjectId).not.toHaveBeenCalled();
    expect(mockAssignRolesToIdentity).toHaveBeenCalledTimes(1);
    expect(result.warnings).toHaveLength(0);
  });
});
