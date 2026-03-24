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
const mockAssignRolesToIdentity = vi.fn();
const mockGetAksOidcIssuerUrl = vi.fn();
const mockCreateK8sFederatedCredential = vi.fn();

vi.mock('../../../utils/azure/az-cli', () => ({
  resourceGroupExists: (...args: any[]) => mockResourceGroupExists(...args),
  getResourceGroupLocation: (...args: any[]) => mockGetResourceGroupLocation(...args),
  createResourceGroup: (...args: any[]) => mockCreateResourceGroup(...args),
}));

vi.mock('../../../utils/azure/az-identity', () => ({
  getManagedIdentity: (...args: any[]) => mockGetManagedIdentity(...args),
  createManagedIdentity: (...args: any[]) => mockCreateManagedIdentity(...args),
  assignRolesToIdentity: (...args: any[]) => mockAssignRolesToIdentity(...args),
  getManagedNamespaceResourceId: vi.fn(),
  buildClusterScope: (sub: string, rg: string, cluster: string) =>
    `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.ContainerService/managedClusters/${cluster}`,
}));

vi.mock('../../../utils/azure/az-federation', () => ({
  getAksOidcIssuerUrl: (...args: any[]) => mockGetAksOidcIssuerUrl(...args),
  createK8sFederatedCredential: (...args: any[]) => mockCreateK8sFederatedCredential(...args),
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

import { getServiceAccountName } from '../../../utils/kubernetes/serviceAccountNames';
import type { DeployWorkloadIdentityConfig } from './useDeployWorkloadIdentity';
import { getDeployIdentityName, useDeployWorkloadIdentity } from './useDeployWorkloadIdentity';

const baseConfig: DeployWorkloadIdentityConfig = {
  subscriptionId: '12345678-1234-1234-1234-123456789abc',
  resourceGroup: 'cluster-rg',
  identityResourceGroup: 'rg-my-app',
  clusterName: 'my-cluster',
  namespace: 'my-namespace',
  appName: 'my-app',
};

describe('getDeployIdentityName', () => {
  it('derives identity name from app name', () => {
    expect(getDeployIdentityName('my-app')).toBe('id-my-app-workload');
  });
});

describe('getServiceAccountName', () => {
  it('sanitizes: lowercase, strips invalid chars, truncates to 63, fallback to app-sa', () => {
    expect(getServiceAccountName('my-app')).toBe('my-app-sa');
  });

  it('converts uppercase to lowercase', () => {
    expect(getServiceAccountName('MyApp')).toBe('myapp-sa');
  });

  it('replaces underscores with hyphens', () => {
    expect(getServiceAccountName('my_app')).toBe('my-app-sa');
  });

  it('falls back for empty string', () => {
    // '' → '-sa' → strip leading hyphen → 'sa'
    expect(getServiceAccountName('')).toBe('sa');
  });

  it('strips trailing hyphens after truncation to 63 chars', () => {
    const longName = 'a'.repeat(60) + '_b'; // underscore becomes hyphen
    const result = getServiceAccountName(longName);
    expect(result.length).toBeLessThanOrEqual(63);
    expect(result).not.toMatch(/-$/);
  });

  it('handles input producing only special characters', () => {
    expect(getServiceAccountName('!!!@@@###')).toBe('sa');
  });
});

describe('useDeployWorkloadIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with idle status', () => {
    const { result } = renderHook(() => useDeployWorkloadIdentity());

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it('happy path: full setup flow returns clientId and serviceAccountName', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockGetAksOidcIssuerUrl.mockResolvedValue({
      success: true,
      issuerUrl: 'https://oidc.example.com',
    });
    mockCreateK8sFederatedCredential.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDeployWorkloadIdentity());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(result.current.status).toBe('done');
    expect(result.current.error).toBeNull();
    expect(result.current.result).toEqual({
      clientId: 'cid',
      serviceAccountName: 'my-app-sa',
    });
  });

  it('sets error when OIDC issuer fetch fails', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockGetAksOidcIssuerUrl.mockResolvedValue({
      success: false,
      error: 'Failed to get OIDC issuer URL',
    });

    const { result } = renderHook(() => useDeployWorkloadIdentity());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('OIDC issuer');
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
    mockGetAksOidcIssuerUrl.mockResolvedValue({
      success: true,
      issuerUrl: 'https://oidc.example.com',
    });
    mockCreateK8sFederatedCredential.mockResolvedValue({
      success: false,
      error: 'Credential already exists',
    });

    const { result } = renderHook(() => useDeployWorkloadIdentity());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Credential already exists');
  });

  it('calls OIDC issuer fetch before federated credential creation', async () => {
    const callOrder: string[] = [];

    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'cid',
      principalId: 'pid',
      tenantId: 'tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockGetAksOidcIssuerUrl.mockImplementation(async () => {
      callOrder.push('fetching-issuer');
      return { success: true, issuerUrl: 'https://oidc.example.com' };
    });
    mockCreateK8sFederatedCredential.mockImplementation(async () => {
      callOrder.push('creating-credential');
      return { success: true };
    });

    const { result } = renderHook(() => useDeployWorkloadIdentity());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(callOrder).toEqual(['fetching-issuer', 'creating-credential']);
    expect(result.current.status).toBe('done');
  });

  it('reuses existing identity when getManagedIdentity returns success', async () => {
    mockResourceGroupExists.mockResolvedValue({ exists: true });
    mockGetManagedIdentity.mockResolvedValue({
      success: true,
      clientId: 'existing-cid',
      principalId: 'existing-pid',
      tenantId: 'existing-tid',
    });
    mockAssignRolesToIdentity.mockResolvedValue({ success: true, results: [] });
    mockGetAksOidcIssuerUrl.mockResolvedValue({
      success: true,
      issuerUrl: 'https://oidc.example.com',
    });
    mockCreateK8sFederatedCredential.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDeployWorkloadIdentity());

    await act(async () => {
      await result.current.setupWorkloadIdentity(baseConfig);
    });

    expect(mockCreateManagedIdentity).not.toHaveBeenCalled();
    expect(result.current.status).toBe('done');
    expect(result.current.result).toEqual({
      clientId: 'existing-cid',
      serviceAccountName: 'my-app-sa',
    });
  });
});
