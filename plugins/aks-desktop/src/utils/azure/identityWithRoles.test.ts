// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResourceGroupExists = vi.fn();
const mockGetResourceGroupLocation = vi.fn();
const mockCreateResourceGroup = vi.fn();
const mockGetManagedIdentity = vi.fn();
const mockCreateManagedIdentity = vi.fn();
const mockAssignRolesToIdentity = vi.fn();
const mockGetManagedNamespaceResourceId = vi.fn();

vi.mock('./az-cli', () => ({
  resourceGroupExists: (...args: any[]) => mockResourceGroupExists(...args),
  getResourceGroupLocation: (...args: any[]) => mockGetResourceGroupLocation(...args),
  createResourceGroup: (...args: any[]) => mockCreateResourceGroup(...args),
}));

vi.mock('./az-identity', () => ({
  getManagedIdentity: (...args: any[]) => mockGetManagedIdentity(...args),
  createManagedIdentity: (...args: any[]) => mockCreateManagedIdentity(...args),
  assignRolesToIdentity: (...args: any[]) => mockAssignRolesToIdentity(...args),
  getManagedNamespaceResourceId: (...args: any[]) => mockGetManagedNamespaceResourceId(...args),
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
});
