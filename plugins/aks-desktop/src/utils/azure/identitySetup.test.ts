// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResourceGroupExists = vi.fn();
const mockGetResourceGroupLocation = vi.fn();
const mockCreateResourceGroup = vi.fn();
const mockGetManagedIdentity = vi.fn();
const mockCreateManagedIdentity = vi.fn();

vi.mock('./az-subscriptions', () => ({
  resourceGroupExists: (...args: any[]) => mockResourceGroupExists(...args),
  getResourceGroupLocation: (...args: any[]) => mockGetResourceGroupLocation(...args),
  createResourceGroup: (...args: any[]) => mockCreateResourceGroup(...args),
}));

vi.mock('./az-identity', () => ({
  getManagedIdentity: (...args: any[]) => mockGetManagedIdentity(...args),
  createManagedIdentity: (...args: any[]) => mockCreateManagedIdentity(...args),
}));

import { ensureIdentityAndResourceGroup } from './identitySetup';

const baseConfig = {
  subscriptionId: '12345678-1234-1234-1234-123456789abc',
  resourceGroup: 'cluster-rg',
  identityResourceGroup: 'identity-rg',
  identityName: 'id-my-app-github',
  onStatusChange: vi.fn(),
};

describe('ensureIdentityAndResourceGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses existing identity when found', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });

    const result = await ensureIdentityAndResourceGroup(baseConfig);

    expect(result).toEqual({
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
      isExisting: true,
    });
    expect(mockCreateManagedIdentity).not.toHaveBeenCalled();
  });

  it('creates RG and identity when neither exists', async () => {
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

    const result = await ensureIdentityAndResourceGroup(baseConfig);

    expect(result).toEqual({
      clientId: 'new-cid',
      principalId: 'new-pid',
      tenantId: 'new-tid',
      isExisting: false,
    });
    expect(mockCreateResourceGroup).toHaveBeenCalledWith({
      resourceGroupName: 'identity-rg',
      location: 'eastus',
      subscriptionId: baseConfig.subscriptionId,
      tags: ['purpose=Managed Identity', 'createdBy=AKS Desktop'],
    });
    expect(mockCreateManagedIdentity).toHaveBeenCalledWith({
      identityName: 'id-my-app-github',
      resourceGroup: 'identity-rg',
      subscriptionId: baseConfig.subscriptionId,
    });
  });

  it('skips RG creation when it already exists', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({ success: false, notFound: true });
    mockCreateManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });

    await ensureIdentityAndResourceGroup(baseConfig);

    expect(mockGetResourceGroupLocation).not.toHaveBeenCalled();
    expect(mockCreateResourceGroup).not.toHaveBeenCalled();
  });

  it('throws when RG existence check returns an error', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: false, error: 'Network error' });

    await expect(ensureIdentityAndResourceGroup(baseConfig)).rejects.toThrow('Network error');
  });

  it('throws when RG creation fails', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: false });
    mockGetResourceGroupLocation.mockResolvedValue('eastus');
    mockCreateResourceGroup.mockResolvedValue({ success: false, error: 'Permission denied' });

    await expect(ensureIdentityAndResourceGroup(baseConfig)).rejects.toThrow('Permission denied');
  });

  it('throws on real identity lookup error (not notFound)', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: false,
      notFound: false,
      error: 'Timeout',
    });

    await expect(ensureIdentityAndResourceGroup(baseConfig)).rejects.toThrow('Timeout');
  });

  it('throws when identity creation fails', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({ success: false, notFound: true });
    mockCreateManagedIdentity.mockResolvedValue({
      success: false,
      error: 'Quota exceeded',
    });

    await expect(ensureIdentityAndResourceGroup(baseConfig)).rejects.toThrow('Quota exceeded');
  });

  it('reports status changes correctly', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({ success: false, notFound: true });
    mockCreateManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });

    await ensureIdentityAndResourceGroup(baseConfig);

    expect(baseConfig.onStatusChange).toHaveBeenCalledWith('creating-rg');
    expect(baseConfig.onStatusChange).toHaveBeenCalledWith('checking');
    expect(baseConfig.onStatusChange).toHaveBeenCalledWith('creating-identity');
  });
});
