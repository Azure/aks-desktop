// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClusterSettings: vi.fn(),
  getClusters: vi.fn(),
  getSubscriptions: vi.fn(),
  setClusterSettings: vi.fn(),
}));

vi.mock('./az-clusters', () => ({ getClusters: mocks.getClusters }));
vi.mock('./az-subscriptions', () => ({ getSubscriptions: mocks.getSubscriptions }));
vi.mock('../shared/clusterSettings', () => ({
  getClusterSettings: mocks.getClusterSettings,
  setClusterSettings: mocks.setClusterSettings,
}));

import { getAKSClusters, getSubscriptions, registerAKSCluster } from './aks';

const desktopRegisterAKSCluster = vi.fn();
const successResult = { success: true, message: 'registered' };

describe('Azure AKS utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClusterSettings.mockReturnValue({ allowedNamespaces: ['existing'] });
    (window as any).desktopApi = {
      registerAKSCluster: desktopRegisterAKSCluster,
    };
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete (window as any).desktopApi;
    vi.restoreAllMocks();
  });

  test('maps subscriptions and supplies legacy fallbacks', async () => {
    mocks.getSubscriptions.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Primary',
        status: 'Enabled',
        tenant: 'tenant-1',
        tenantName: 'Primary tenant',
      },
      { id: 'sub-2', name: 'Guest', tenant: 'tenant-2' },
    ]);

    await expect(getSubscriptions()).resolves.toEqual({
      success: true,
      message: 'Subscriptions retrieved successfully',
      subscriptions: [
        {
          id: 'sub-1',
          name: 'Primary',
          state: 'Enabled',
          tenantId: 'tenant-1',
          tenantName: 'Primary tenant',
          isDefault: false,
        },
        {
          id: 'sub-2',
          name: 'Guest',
          state: 'Unknown',
          tenantId: 'tenant-2',
          tenantName: 'tenant-2',
          isDefault: false,
        },
      ],
    });
  });

  test.each([
    [new Error('subscription failure'), 'subscription failure'],
    ['subscription failure', 'Unknown error'],
  ])('reports subscription errors without throwing', async (error, message) => {
    mocks.getSubscriptions.mockRejectedValue(error);

    await expect(getSubscriptions()).resolves.toEqual({ success: false, message });
  });

  test('maps clusters and detects Azure RBAC configuration', async () => {
    mocks.getClusters.mockResolvedValue([
      {
        name: 'cluster-1',
        resourceGroup: 'rg-1',
        location: 'eastus',
        version: '1.32.0',
        status: 'Succeeded',
        aadProfile: { enableAzureRbac: true },
      },
      {
        name: 'cluster-2',
        resourceGroup: 'rg-2',
        location: 'westus',
        version: '1.31.0',
        status: 'Updating',
        aadProfile: { enableAzureRbac: false },
      },
      {
        name: 'cluster-3',
        resourceGroup: 'rg-3',
        location: 'centralus',
        version: '1.30.0',
        status: 'Succeeded',
        aadProfile: null,
      },
      {
        name: 'cluster-4',
        resourceGroup: 'rg-4',
        location: 'northcentralus',
        version: '1.29.0',
        status: 'Succeeded',
      },
    ]);

    await expect(getAKSClusters('sub-1')).resolves.toEqual({
      success: true,
      message: 'AKS clusters retrieved successfully',
      clusters: [
        {
          name: 'cluster-1',
          resourceGroup: 'rg-1',
          location: 'eastus',
          kubernetesVersion: '1.32.0',
          provisioningState: 'Succeeded',
          fqdn: '',
          isAzureRBACEnabled: true,
        },
        {
          name: 'cluster-2',
          resourceGroup: 'rg-2',
          location: 'westus',
          kubernetesVersion: '1.31.0',
          provisioningState: 'Updating',
          fqdn: '',
          isAzureRBACEnabled: false,
        },
        {
          name: 'cluster-3',
          resourceGroup: 'rg-3',
          location: 'centralus',
          kubernetesVersion: '1.30.0',
          provisioningState: 'Succeeded',
          fqdn: '',
          isAzureRBACEnabled: false,
        },
        {
          name: 'cluster-4',
          resourceGroup: 'rg-4',
          location: 'northcentralus',
          kubernetesVersion: '1.29.0',
          provisioningState: 'Succeeded',
          fqdn: '',
          isAzureRBACEnabled: false,
        },
      ],
    });
  });

  test.each([
    [new Error('cluster failure'), 'cluster failure'],
    ['cluster failure', 'Unknown error'],
  ])('reports cluster errors without throwing', async (error, message) => {
    mocks.getClusters.mockRejectedValue(error);

    await expect(getAKSClusters('sub-1')).resolves.toEqual({ success: false, message });
  });

  test('passes the AKS cluster type to the desktop API', async () => {
    desktopRegisterAKSCluster.mockResolvedValue(successResult);

    await registerAKSCluster('sub-1', 'rg-1', 'cluster-1', 'namespace-1');

    expect(desktopRegisterAKSCluster).toHaveBeenCalledWith(
      'sub-1',
      'rg-1',
      'cluster-1',
      false,
      'namespace-1',
      'aks'
    );
    expect(mocks.setClusterSettings).toHaveBeenCalledWith('cluster-1', {
      allowedNamespaces: ['existing'],
      azureRegistration: {
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
      },
    });
  });

  test('reports when the desktop registration API is unavailable', async () => {
    delete (window as any).desktopApi;

    await expect(registerAKSCluster('sub-1', 'rg-1', 'cluster-1')).resolves.toEqual({
      success: false,
      message: 'Desktop API not available. This feature is only available in desktop mode.',
    });
  });

  test('prevents concurrent registrations from losing a kubeconfig update', async () => {
    let registeredClusters: string[] = [];
    let markFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>(resolve => {
      markFirstStarted = resolve;
    });
    const firstMayFinish = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    desktopRegisterAKSCluster.mockImplementation(
      async (_subscriptionId: string, _resourceGroup: string, clusterName: string) => {
        const existingClusters = [...registeredClusters];
        if (clusterName === 'cluster-1') {
          markFirstStarted();
          await firstMayFinish;
        }
        registeredClusters = [...existingClusters, clusterName];
        return successResult;
      }
    );

    const first = registerAKSCluster('sub-1', 'rg-1', 'cluster-1');
    await firstStarted;
    const second = registerAKSCluster('sub-2', 'rg-2', 'cluster-2');

    expect(registeredClusters).toEqual([]);
    releaseFirst();

    await Promise.all([first, second]);
    expect(registeredClusters).toEqual(['cluster-1', 'cluster-2']);
  });

  test('continues the queue after a desktop registration rejects', async () => {
    desktopRegisterAKSCluster
      .mockRejectedValueOnce(new Error('registration failed'))
      .mockResolvedValueOnce(successResult);

    const first = registerAKSCluster('sub-1', 'rg-1', 'cluster-1');
    const second = registerAKSCluster('sub-2', 'rg-2', 'cluster-2');

    await expect(first).resolves.toEqual({
      success: false,
      message: 'registration failed',
    });
    await expect(second).resolves.toEqual(successResult);
    expect(desktopRegisterAKSCluster).toHaveBeenCalledTimes(2);
  });

  test('normalizes non-Error desktop failures', async () => {
    desktopRegisterAKSCluster.mockRejectedValue('registration failed');

    await expect(registerAKSCluster('sub-1', 'rg-1', 'cluster-1')).resolves.toEqual({
      success: false,
      message: 'Unknown error',
    });
  });

  test('reports a malformed desktop registration response', async () => {
    desktopRegisterAKSCluster.mockResolvedValue(undefined);

    await expect(registerAKSCluster('sub-1', 'rg-1', 'cluster-1')).resolves.toEqual({
      success: false,
      message: 'Cluster registration returned an invalid response.',
    });
  });
});
