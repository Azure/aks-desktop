// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getAzureCloudEndpoints: vi.fn(),
  getClustersViaGraph: vi.fn(),
  getSubscriptionCredential: vi.fn(),
  runCommandAsync: vi.fn(),
}));

vi.mock('./az-cli-core', () => ({
  debugLog: vi.fn(),
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Unknown error'),
  isAzError: () => false,
  needsRelogin: () => false,
  runCommandAsync: mocks.runCommandAsync,
}));

vi.mock('./az-cloud', () => ({
  getAzureCloudEndpoints: mocks.getAzureCloudEndpoints,
}));

vi.mock('./az-token', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-token')>()),
  getSubscriptionCredential: mocks.getSubscriptionCredential,
}));

vi.mock('./az-resource-graph', () => ({
  getClusterResourceGroupViaGraph: vi.fn(),
  getClustersViaGraph: mocks.getClustersViaGraph,
}));

vi.mock('./az-subscriptions', () => ({ getSubscriptions: vi.fn() }));

import { getClusters, getConnectedClusters } from './az-clusters';

describe('getClusters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  test('preserves the AAD profile from the CLI fallback', async () => {
    mocks.getClustersViaGraph.mockRejectedValue(new Error('graph unavailable'));
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify([
        {
          name: 'cluster-1',
          resourceGroup: 'rg-1',
          location: 'eastus',
          kubernetesVersion: '1.32.0',
          provisioningState: 'Succeeded',
          aadProfile: { enableAzureRbac: true },
        },
      ]),
      stderr: '',
    });

    await expect(getClusters('sub-1')).resolves.toEqual([
      expect.objectContaining({ aadProfile: { enableAzureRbac: true } }),
    ]);
  });
});

describe('getConnectedClusters', () => {
  const subscriptionId = '00000000-0000-0000-0000-000000000001';
  const credential = {
    getToken: vi.fn(async () => ({ token: 'token', expiresOnTimestamp: Date.now() + 3600_000 })),
  };

  function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status });
  }

  function connectedCluster(
    name: string,
    resourceGroup: string,
    kind: string | null,
    properties: Record<string, unknown> = {}
  ) {
    return {
      id: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Kubernetes/connectedClusters/${name}`,
      name,
      location: 'westus',
      kind,
      properties: {
        connectivityStatus: 'Connected',
        provisioningState: 'Succeeded',
        ...properties,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.getSubscriptionCredential.mockReturnValue(credential);
    mocks.getAzureCloudEndpoints.mockResolvedValue({
      endpoint: 'https://management.azure.com',
      scope: 'https://management.core.windows.net//.default',
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('lists connected clusters through ARM with the subscription credential', async () => {
    mocks.fetch.mockResolvedValue(json(200, { value: [] }));

    await expect(getConnectedClusters(subscriptionId)).resolves.toEqual({ clusters: [] });

    expect(mocks.getSubscriptionCredential).toHaveBeenCalledWith(subscriptionId);
    expect(String(mocks.fetch.mock.calls[0][0])).toBe(
      `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Kubernetes/connectedClusters?api-version=2024-01-01`
    );
    expect(mocks.runCommandAsync).not.toHaveBeenCalled();
  });

  test('maps nested ARM properties and the resource group from the resource ID', async () => {
    mocks.fetch.mockResolvedValue(
      json(200, {
        value: [
          connectedCluster('hybrid-edge', 'Arc-RG', 'ProvisionedCluster', {
            kubernetesVersion: '1.31.2',
            aadProfile: { enableAzureRBAC: true },
          }),
        ],
      })
    );

    await expect(getConnectedClusters(subscriptionId)).resolves.toEqual({
      clusters: [
        {
          name: 'hybrid-edge',
          subscription: subscriptionId,
          resourceGroup: 'Arc-RG',
          location: 'westus',
          version: '1.31.2',
          status: 'Succeeded',
          powerState: 'Connected',
          connectivityStatus: 'Connected',
          nodeCount: 0,
          clusterType: 'aksarc',
          azureRbacEnabled: true,
        },
      ],
    });
  });

  test('reads the resource group from IDs with any casing', async () => {
    const cluster = connectedCluster('hybrid-edge', 'arc-rg', 'ProvisionedCluster');
    cluster.id = cluster.id.replace('/resourceGroups/', '/resourcegroups/');
    mocks.fetch.mockResolvedValue(json(200, { value: [cluster] }));

    const { clusters } = await getConnectedClusters(subscriptionId);

    expect(clusters[0].resourceGroup).toBe('arc-rg');
  });

  test('excludes generic Arc-connected clusters', async () => {
    mocks.fetch.mockResolvedValue(
      json(200, {
        value: [
          connectedCluster('hybrid-edge', 'arc-rg', 'ProvisionedCluster'),
          connectedCluster('generic-arc', 'generic-rg', null, { distribution: 'k3s' }),
          connectedCluster('aws-arc', 'aws-rg', 'AWS'),
        ],
      })
    );

    const { clusters } = await getConnectedClusters(subscriptionId);

    expect(clusters.map(cluster => cluster.name)).toEqual(['hybrid-edge']);
  });

  test('keeps offline clusters and falls back to the agent version and connectivity', async () => {
    mocks.fetch.mockResolvedValue(
      json(200, {
        value: [
          connectedCluster('offline', 'arc-rg', 'ProvisionedCluster', {
            agentVersion: '1.20.0',
            connectivityStatus: 'Offline',
            provisioningState: undefined,
          }),
        ],
      })
    );

    const { clusters } = await getConnectedClusters(subscriptionId);

    expect(clusters).toEqual([
      expect.objectContaining({
        name: 'offline',
        version: '1.20.0',
        status: 'Offline',
        powerState: 'Offline',
        connectivityStatus: 'Offline',
        azureRbacEnabled: false,
      }),
    ]);
  });

  test('uses Unknown when connectivity and provisioning state are missing', async () => {
    mocks.fetch.mockResolvedValue(
      json(200, {
        value: [{ id: 'not-an-arm-id', name: 'bare', kind: 'ProvisionedCluster' }],
      })
    );

    const { clusters } = await getConnectedClusters(subscriptionId);

    expect(clusters).toEqual([
      expect.objectContaining({
        resourceGroup: '',
        location: '',
        version: '',
        status: 'Unknown',
        powerState: 'Unknown',
        connectivityStatus: 'Unknown',
      }),
    ]);
  });

  test('follows nextLink pages', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(200, {
          value: [connectedCluster('page-1', 'rg-1', 'ProvisionedCluster')],
          nextLink: `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Kubernetes/connectedClusters?api-version=2024-01-01&$skiptoken=abc`,
        })
      )
      .mockResolvedValueOnce(
        json(200, { value: [connectedCluster('page-2', 'rg-2', 'ProvisionedCluster')] })
      );

    const { clusters, error } = await getConnectedClusters(subscriptionId);

    expect(error).toBeUndefined();
    expect(clusters.map(cluster => [cluster.name, cluster.resourceGroup])).toEqual([
      ['page-1', 'rg-1'],
      ['page-2', 'rg-2'],
    ]);
    expect(String(mocks.fetch.mock.calls[1][0])).toContain('skiptoken=abc');
  });

  test('returns the Azure error instead of throwing when listing fails', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'AuthorizationFailed', message: 'No read access to connected clusters.' },
        }),
        { status: 403, headers: { 'x-ms-request-id': 'request-1' } }
      )
    );

    const result = await getConnectedClusters(subscriptionId);

    expect(result.clusters).toEqual([]);
    expect(result.error).toContain('AuthorizationFailed');
    expect(result.error).toContain('No read access to connected clusters.');
    expect(result.error).toContain('HTTP 403');
    expect(result.error).toContain('request-1');
  });

  test('returns an error for a page that fails after an earlier page succeeded', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(200, {
          value: [connectedCluster('page-1', 'rg-1', 'ProvisionedCluster')],
          nextLink: `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Kubernetes/connectedClusters?$skiptoken=abc`,
        })
      )
      .mockResolvedValueOnce(json(403, { error: { code: 'AuthorizationFailed', message: 'x' } }));

    const result = await getConnectedClusters(subscriptionId);

    expect(result.clusters).toEqual([]);
    expect(result.error).toContain('AuthorizationFailed');
  });

  test('uses the active Azure CLI cloud endpoint and token scope', async () => {
    mocks.getAzureCloudEndpoints.mockResolvedValue({
      endpoint: 'https://management.usgovcloudapi.net',
      scope: 'https://management.core.usgovcloudapi.net/.default',
    });
    mocks.fetch.mockResolvedValue(json(200, { value: [] }));

    await getConnectedClusters(subscriptionId);

    expect(String(mocks.fetch.mock.calls[0][0])).toMatch(
      /^https:\/\/management\.usgovcloudapi\.net\/subscriptions\//
    );
    expect(credential.getToken).toHaveBeenCalledWith(
      'https://management.core.usgovcloudapi.net/.default',
      expect.anything()
    );
  });

  test('returns an error when the Azure cloud cannot be read', async () => {
    mocks.getAzureCloudEndpoints.mockRejectedValue(new Error('cloud show failed'));

    await expect(getConnectedClusters(subscriptionId)).resolves.toEqual({
      clusters: [],
      error: 'cloud show failed',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('returns an error for an invalid subscription ID', async () => {
    mocks.getSubscriptionCredential.mockImplementation(() => {
      throw new Error('Invalid subscription ID format');
    });

    await expect(getConnectedClusters('not-a-guid')).resolves.toEqual({
      clusters: [],
      error: 'Invalid subscription ID format',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
