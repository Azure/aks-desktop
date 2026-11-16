// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getAzureCloudEndpoints: vi.fn(),
  getClustersViaGraph: vi.fn(),
  getClusterResourceGroupViaGraph: vi.fn(),
  getLoginStatus: vi.fn(),
  getSubscriptions: vi.fn(),
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
  getClusterResourceGroupViaGraph: mocks.getClusterResourceGroupViaGraph,
  getClustersViaGraph: mocks.getClustersViaGraph,
}));

vi.mock('./az-auth', () => ({ getLoginStatus: mocks.getLoginStatus }));
vi.mock('./az-subscriptions', () => ({ getSubscriptions: mocks.getSubscriptions }));

import {
  getClusterInfo,
  getClusterResourceIdAndGroup,
  getClusters,
  getConnectedClusters,
} from './az-clusters';
import { AzTokenError } from './az-token';

describe('managed cluster discovery', () => {
  const subscription = '00000000-0000-0000-0000-000000000001';
  const tenant = '00000000-0000-0000-0000-000000000002';
  const other = '00000000-0000-0000-0000-000000000003';
  const credential = { getToken: vi.fn() };
  const selected = { clusterName: 'target', subscriptionId: subscription };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const resource = (name = 'target', group = 'group-1') => ({
    id: `/subscriptions/${subscription}/resourcegroups/${group}/providers/Microsoft.ContainerService/managedClusters/${name}`,
    name,
    location: 'westus',
    properties: {
      kubernetesVersion: '1.32.0',
      provisioningState: 'Succeeded',
      powerState: { code: 'Stopped' },
      aadProfile: { enableAzureRBAC: false, managed: true },
      agentPoolProfiles: [{ count: 2, vmSize: 'size-1' }, {}, { count: 3 }],
    },
  });
  const denied = () => json({ error: { code: 'AuthorizationFailed', message: 'No access' } }, 403);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    credential.getToken.mockResolvedValue({
      token: 'synthetic',
      expiresOnTimestamp: Date.now() + 3600_000,
    });
    mocks.getSubscriptionCredential.mockReturnValue(credential);
    mocks.getAzureCloudEndpoints.mockResolvedValue({
      endpoint: 'https://management.usgovcloudapi.net',
      scope: 'https://management.core.usgovcloudapi.net//.default',
    });
    mocks.getClustersViaGraph.mockRejectedValue(new Error('graph unavailable'));
    mocks.getClusterResourceGroupViaGraph.mockResolvedValue(null);
    mocks.getLoginStatus.mockResolvedValue({
      isLoggedIn: true,
      subscriptionId: subscription,
      tenantId: tenant,
    });
    mocks.getSubscriptions.mockResolvedValue([
      { id: subscription, tenant },
      { id: other, tenant },
    ]);
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mocks.fetch.mockImplementation(async () => json({ value: [resource()] }));
    vi.stubGlobal('fetch', mocks.fetch);
  });
  afterEach(() => {
    // Account, cloud, token and subscription providers are injected; only the retained context path may spawn kubectl.
    expect(mocks.runCommandAsync.mock.calls.every(([cmd]) => cmd === 'kubectl')).toBe(true);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test.each([[], [{ name: 'graph-first' }]])('keeps successful Graph results: %j', async rows => {
    mocks.getClustersViaGraph.mockResolvedValue(rows);
    expect(await getClusters(subscription)).toEqual(rows);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('maps nested ARM fields and preserves duplicate names through both nextLink forms', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json({ value: [resource()], nextLink: '?page=2' }))
      .mockResolvedValueOnce(
        json({
          value: [resource('target', 'group-2')],
          nextLink: 'https://management.usgovcloudapi.net/list?page=3',
        })
      )
      .mockResolvedValueOnce(json({ value: [{ name: 'bare' }] }));
    const rows = await getClusters(subscription);
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'target',
        resourceGroup: 'group-1',
        subscription,
        location: 'westus',
        version: '1.32.0',
        status: 'Succeeded',
        powerState: 'Stopped',
        nodeCount: 5,
        aadProfile: { enableAzureRbac: false, managed: true },
      }),
      expect.objectContaining({ name: 'target', resourceGroup: 'group-2' }),
      expect.objectContaining({ name: 'bare', powerState: 'Unknown', nodeCount: 0 }),
    ]);
    expect(rows[0]).not.toHaveProperty('id');
    expect(rows[0]).not.toHaveProperty('vmSize');
    expect(String(mocks.fetch.mock.calls[0][0])).toBe(
      `https://management.usgovcloudapi.net/subscriptions/${subscription}/providers/Microsoft.ContainerService/managedClusters?api-version=2026-01-01`
    );
    expect(String(mocks.fetch.mock.calls[1][0])).toContain('page=2');
    expect(credential.getToken).toHaveBeenCalledWith(
      'https://management.core.usgovcloudapi.net//.default',
      expect.anything()
    );
  });

  test('AAD filter excludes missing/null profiles but keeps false RBAC', async () => {
    mocks.fetch.mockResolvedValue(
      json({ value: [resource(), { properties: { aadProfile: null } }, { properties: null }] })
    );
    const rows = await getClusters(subscription, '[?aadProfile!=null]');
    expect(rows).toHaveLength(1);
    expect(rows[0].aadProfile.enableAzureRbac).toBe(false);
    expect(mocks.getClustersViaGraph).toHaveBeenCalledWith(subscription, true);
  });

  test('all subscriptions retain IDs and first-pool size, without applying the query', async () => {
    mocks.fetch.mockImplementation(async () =>
      json({ value: [resource(), { name: 'bare', properties: null }] })
    );
    const rows = await getClusters(undefined, '[?aadProfile!=null]');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ id: resource().id, subscription, vmSize: 'size-1' });
    expect(rows[1]).toMatchObject({ vmSize: '', powerState: 'Unknown', nodeCount: 0 });
    expect(rows[2].subscription).toBe(other);
    expect(rows[0]).not.toHaveProperty('aadProfile');
    expect(mocks.getSubscriptionCredential.mock.calls).toEqual([[subscription], [other]]);
    expect(credential.getToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tenantId: tenant })
    );
    expect(mocks.getClustersViaGraph).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    'keeps reachable subscriptions after page failure (later page: %s)',
    async laterPage => {
      if (laterPage)
        mocks.fetch.mockResolvedValueOnce(
          json({ value: [resource('discard')], nextLink: '?page=2' })
        );
      mocks.fetch.mockResolvedValueOnce(denied());
      expect(await getClusters()).toEqual([
        expect.objectContaining({ name: 'target', subscription: other }),
      ]);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining(subscription),
        expect.stringContaining('AuthorizationFailed')
      );
    }
  );

  test('all-failed returns empty results with a warning per subscription', async () => {
    mocks.fetch.mockImplementation(async () => denied());
    expect(await getClusters()).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  test.each(['list', 'id'])('surfaces HTTP metadata instead of absence for %s', async operation => {
    mocks.fetch.mockImplementation(async () => denied());
    await expect(
      operation === 'list'
        ? getClusters(subscription)
        : getClusterResourceIdAndGroup('target', subscription)
    ).rejects.toMatchObject({ status: 403, code: 'AuthorizationFailed' });
  });

  test('does not turn a failed or untrusted continuation into a successful prefix', async () => {
    for (const nextLink of ['?page=2', 'https://untrusted.example/page']) {
      mocks.fetch
        .mockReset()
        .mockResolvedValueOnce(json({ value: [resource()], nextLink }))
        .mockResolvedValueOnce(denied());
      await expect(getClusters(subscription)).rejects.toThrow(
        nextLink.startsWith('?') ? 'AuthorizationFailed' : 'untrusted'
      );
    }
  });

  test.each(['info', 'id'])('finds the first exact match across pages for %s', async operation => {
    mocks.fetch
      .mockResolvedValueOnce(json({ value: [resource('other')], nextLink: '?page=2' }))
      .mockResolvedValueOnce(json({ value: [resource(), resource('target', 'group-2')] }));
    expect(
      await (operation === 'info'
        ? getClusterInfo('target')
        : getClusterResourceIdAndGroup('target', subscription))
    ).toEqual(
      operation === 'info'
        ? { ...selected, resourceGroup: 'group-1' }
        : { resourceId: resource().id, resourceGroup: 'group-1' }
    );
  });

  test('keeps Graph group success and the provider-selected subscription', async () => {
    mocks.getClusterResourceGroupViaGraph.mockResolvedValue('graph-group');
    expect(await getClusterInfo('target')).toEqual({ ...selected, resourceGroup: 'graph-group' });
    expect(mocks.getClusterResourceGroupViaGraph).toHaveBeenCalledWith('target', subscription);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test.each(['', 'group_target'])('uses context or first cluster: %s', async context => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: context, stderr: '' });
    expect(await getClusterInfo()).toEqual({ ...selected, resourceGroup: 'group-1' });
    expect(mocks.runCommandAsync).toHaveBeenCalledWith('kubectl', ['config', 'current-context']);
    expect(credential.getToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tenantId: tenant })
    );
  });

  test.each(['InteractionRequired', 'AADSTS50076', 'No subscriptions found'])(
    'adapts the account provider error: %s',
    async error => {
      mocks.getLoginStatus.mockResolvedValue({ isLoggedIn: false, error });
      await expect(getClusterInfo('target')).rejects.toThrow(
        error.startsWith('No') ? 'No Azure subscriptions found' : 'requires re-authentication'
      );
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  test('ordinary account failure is best effort, and invalid names never list', async () => {
    mocks.getLoginStatus.mockResolvedValueOnce({
      isLoggedIn: false,
      error: 'temporarily unavailable',
    });
    expect(await getClusterInfo('target')).toEqual({});
    expect(await getClusterInfo('invalid/name')).toEqual({ subscriptionId: subscription });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('successful absence differs from a failed named lookup', async () => {
    mocks.fetch.mockImplementation(async () => json({ value: [{ name: 'target' }] }));
    expect(await getClusterResourceIdAndGroup('target', subscription)).toBeNull();
    expect(await getClusterResourceIdAndGroup('', subscription)).toBeNull();
    mocks.fetch.mockImplementation(async () => json({ value: [] }));
    expect(await getClusterResourceIdAndGroup('target', subscription)).toBeNull();
    expect(await getClusterInfo('target')).toEqual(selected);
    mocks.fetch.mockImplementation(async () => denied());
    expect(await getClusterInfo('target')).toEqual(selected);
  });

  test('keeps the actionable re-login message for credential failures', async () => {
    credential.getToken.mockRejectedValue(new AzTokenError('expired', true));
    await expect(getClusterResourceIdAndGroup('target', subscription)).rejects.toThrow(
      'Authentication required. Please log in to Azure CLI: az login'
    );
  });

  test('rejects invalid subscriptions before cloud metadata or HTTP', async () => {
    mocks.getSubscriptionCredential.mockImplementation(() => {
      throw new AzTokenError('Invalid subscription ID format');
    });
    await expect(getClusters('invalid')).rejects.toThrow('Invalid subscription ID format');
    expect(mocks.getAzureCloudEndpoints).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
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
