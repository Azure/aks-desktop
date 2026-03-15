// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResourceGroupExists = vi.fn();
const mockGetResourceGroupLocation = vi.fn();
const mockCreateResourceGroup = vi.fn();
const mockGetManagedIdentity = vi.fn();
const mockCreateManagedIdentity = vi.fn();
const mockAssignRoleToIdentity = vi.fn();
const mockCreateFederatedCredential = vi.fn();

vi.mock('../../../utils/azure/az-cli', () => ({
  resourceGroupExists: (...args: any[]) => mockResourceGroupExists(...args),
  getResourceGroupLocation: (...args: any[]) => mockGetResourceGroupLocation(...args),
  createResourceGroup: (...args: any[]) => mockCreateResourceGroup(...args),
  getManagedIdentity: (...args: any[]) => mockGetManagedIdentity(...args),
  createManagedIdentity: (...args: any[]) => mockCreateManagedIdentity(...args),
  assignRoleToIdentity: (...args: any[]) => mockAssignRoleToIdentity(...args),
  createFederatedCredential: (...args: any[]) => mockCreateFederatedCredential(...args),
}));

import type { WorkloadIdentitySetupConfig } from './useWorkloadIdentitySetup';
import { getIdentityName, useWorkloadIdentitySetup } from './useWorkloadIdentitySetup';

const baseConfig: WorkloadIdentitySetupConfig = {
  subscriptionId: '12345678-1234-1234-1234-123456789abc',
  resourceGroup: 'cluster-rg',
  identityResourceGroup: 'rg-my-project',
  projectName: 'my-project',
  repo: { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' },
};

describe('getIdentityName', () => {
  it('derives identity name from project name', () => {
    expect(getIdentityName('my-project')).toBe('id-my-project-github');
  });

  it('handles empty string', () => {
    expect(getIdentityName('')).toBe('id--github');
  });
});

describe('useWorkloadIdentitySetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with idle status', () => {
    const { result } = renderHook(() => useWorkloadIdentitySetup());

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
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
    mockAssignRoleToIdentity.mockResolvedValue({ success: true });
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
    mockAssignRoleToIdentity.mockResolvedValue({ success: true });
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
    mockAssignRoleToIdentity.mockResolvedValue({ success: true });
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
    // Role assignment uses the cluster resourceGroup
    expect(mockAssignRoleToIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ resourceGroup: 'cluster-rg' })
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
    mockAssignRoleToIdentity.mockResolvedValue({ success: true });
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
    mockAssignRoleToIdentity.mockResolvedValue({
      success: false,
      error: 'Forbidden',
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
    mockAssignRoleToIdentity.mockResolvedValue({ success: true });
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
