// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  azRequest: vi.fn(),
  azListAll: vi.fn(),
  runCommandAsync: vi.fn(),
  cloud: { endpoint: 'https://management.usgovcloudapi.net', scope: 'https://gov/.default' },
}));

vi.mock('./az-cloud', () => ({
  getAzureCloudEndpoints: vi.fn(async () => mocks.cloud),
}));

vi.mock('./az-cli-core', () => ({
  debugLog: vi.fn(),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unknown error'),
  isValidGuid: (s: string) => /^[0-9a-f-]{36}$/.test(s),
  runCommandAsync: mocks.runCommandAsync,
}));

vi.mock('./az-http', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-http')>()),
  azRequest: mocks.azRequest,
  azListAll: mocks.azListAll,
}));

import { AzureRequestError } from './az-http';
import {
  getClusterCount,
  getClusterResourceGroupViaGraph,
  getClustersViaGraph,
  getManagedNamespacesViaGraph,
  queryResourceGraph,
} from './az-resource-graph';
import { getSubscriptionCredential } from './az-token';

const SUBSCRIPTION_ID = '00000000-0000-0000-0000-000000000000';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

/** Builds one Resource Graph response page. */
const page = (data: unknown[], extra: Record<string, unknown> = {}) => ({
  data,
  resultTruncated: 'false',
  ...extra,
});

/** Returns the KQL query sent in the first request. */
const queryOf = (): string => mocks.azRequest.mock.calls[0][0].body.query;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('queryResourceGraph', () => {
  test('POSTs the raw query with subscriptions, page size, and object results', async () => {
    mocks.azRequest.mockResolvedValue(page([{ id: 'a' }]));
    const signal = new AbortController().signal;

    await expect(
      queryResourceGraph("Resources | where name == 'x'", [SUBSCRIPTION_ID], {
        tenantId: TENANT_A,
        signal,
      })
    ).resolves.toEqual([{ id: 'a' }]);
    expect(mocks.azRequest).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      signal,
      credential: getSubscriptionCredential(SUBSCRIPTION_ID),
      ...mocks.cloud,
      url: '/providers/Microsoft.ResourceGraph/resources',
      method: 'POST',
      apiVersion: '2022-10-01',
      maxRetries: 3,
      body: {
        subscriptions: [SUBSCRIPTION_ID],
        query: "Resources | where name == 'x'",
        options: { resultFormat: 'objectArray', $top: 1000 },
      },
    });
  });

  test('omits subscriptions to search the whole tenant', async () => {
    mocks.azRequest.mockResolvedValue(page([]));
    await queryResourceGraph('Resources');
    expect(mocks.azRequest.mock.calls[0][0].body).not.toHaveProperty('subscriptions');
    expect(mocks.azRequest.mock.calls[0][0].credential).toBeUndefined();
  });

  test('keeps an explicit credential instead of the subscription credential', async () => {
    mocks.azRequest.mockResolvedValue(page([]));
    const credential = { getToken: vi.fn() };
    await queryResourceGraph('Resources', [SUBSCRIPTION_ID], { credential });
    expect(mocks.azRequest.mock.calls[0][0].credential).toBe(credential);
  });

  test('follows $skipToken to return more than 1,000 rows', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` }));
    const second = Array.from({ length: 500 }, (_, i) => ({ id: `r${1000 + i}` }));
    mocks.azRequest
      .mockResolvedValueOnce(page(first, { $skipToken: 'next' }))
      .mockResolvedValueOnce(page(second));

    const rows = await queryResourceGraph('Resources', [SUBSCRIPTION_ID]);

    expect(rows).toHaveLength(1500);
    expect(mocks.azRequest).toHaveBeenCalledTimes(2);
    expect(mocks.azRequest.mock.calls[1][0].body.options).toEqual({
      resultFormat: 'objectArray',
      $top: 1000,
      $skipToken: 'next',
    });
  });

  test('throws when results are truncated without a $skipToken', async () => {
    mocks.azRequest.mockResolvedValue(page([{ count: 1 }], { resultTruncated: 'true' }));
    await expect(queryResourceGraph('Resources | summarize count()')).rejects.toThrow(
      'Resource Graph results were truncated'
    );
  });

  test('throws when the page limit is reached', async () => {
    mocks.azRequest.mockResolvedValue(page([{ id: 'a' }], { $skipToken: 'more' }));
    await expect(queryResourceGraph('Resources')).rejects.toThrow('exceeded 100 pages');
    expect(mocks.azRequest).toHaveBeenCalledTimes(100);
  });

  test('throws when data is not an array', async () => {
    mocks.azRequest.mockResolvedValue({ data: { rows: [] } });
    await expect(queryResourceGraph('Resources')).rejects.toThrow('`data` is not an array');
  });

  test('does not run az commands', async () => {
    mocks.azRequest.mockResolvedValue(page([]));
    await queryResourceGraph('Resources');
    expect(mocks.runCommandAsync).not.toHaveBeenCalled();
  });
});

describe('getClustersViaGraph', () => {
  test('preserves the explicit Azure RBAC value', async () => {
    mocks.azRequest.mockResolvedValue(
      page([
        {
          id: '/c/rbac-enabled',
          name: 'rbac-enabled',
          resourceGroup: 'rg-1',
          location: 'eastus',
          version: '1.32.0',
          status: 'Succeeded',
          powerState: 'Running',
          nodeCount: 3,
          azureRbacEnabled: true,
        },
        {
          id: '/c/rbac-disabled',
          name: 'rbac-disabled',
          resourceGroup: 'rg-2',
          location: 'westus',
          version: '1.31.0',
          status: 'Succeeded',
          powerState: 'Running',
          nodeCount: 2,
          azureRbacEnabled: false,
        },
      ])
    );

    const clusters = await getClustersViaGraph(SUBSCRIPTION_ID);

    expect(clusters.map(cluster => cluster.aadProfile)).toEqual([
      { enableAzureRbac: true },
      { enableAzureRbac: false },
    ]);
  });

  test('maps rows and defaults missing power state and node count', async () => {
    mocks.azRequest.mockResolvedValue(
      page([{ id: '/c/a', name: 'a', resourceGroup: 'rg', location: 'eastus' }])
    );

    await expect(getClustersViaGraph(SUBSCRIPTION_ID)).resolves.toEqual([
      expect.objectContaining({
        name: 'a',
        subscription: SUBSCRIPTION_ID,
        powerState: 'Unknown',
        nodeCount: 0,
        aadProfile: undefined,
      }),
    ]);
  });

  test('scopes to the subscription and keeps id so results can be paged', async () => {
    mocks.azRequest.mockResolvedValue(page([]));
    await getClustersViaGraph(SUBSCRIPTION_ID, true);

    expect(mocks.azRequest.mock.calls[0][0].body.subscriptions).toEqual([SUBSCRIPTION_ID]);
    expect(queryOf()).toMatch(/by\s+id,/);
    expect(queryOf()).toContain('isnotnull(properties.aadProfile)');
  });

  test('throws on an invalid subscription ID or a failed query', async () => {
    await expect(getClustersViaGraph('not-a-guid')).rejects.toThrow('Invalid subscription ID');
    mocks.azRequest.mockRejectedValue(new AzureRequestError('Forbidden', { status: 403 }));
    await expect(getClustersViaGraph(SUBSCRIPTION_ID)).rejects.toThrow('Forbidden');
  });
});

describe('getClusterResourceGroupViaGraph', () => {
  test('resolves the resource group when the name is unambiguous', async () => {
    mocks.azRequest.mockResolvedValue(page([{ resourceGroup: 'rg-a' }]));

    await expect(getClusterResourceGroupViaGraph('solo', SUBSCRIPTION_ID)).resolves.toBe('rg-a');
    expect(mocks.azRequest.mock.calls[0][0].body.subscriptions).toEqual([SUBSCRIPTION_ID]);
  });

  test('deduplicates resource groups before applying the ambiguity limit', async () => {
    mocks.azRequest.mockResolvedValue(page([{ resourceGroup: 'rg-a' }, { resourceGroup: 'rg-b' }]));

    await expect(getClusterResourceGroupViaGraph('shared', SUBSCRIPTION_ID)).resolves.toBeNull();
    expect(queryOf()).toContain('summarize by resourceGroup');
    expect(queryOf().indexOf('summarize by resourceGroup')).toBeLessThan(
      queryOf().indexOf('| limit 2')
    );
  });

  test('restricts the query to one provider when the kind is known', async () => {
    mocks.azRequest.mockResolvedValue(page([{ resourceGroup: 'rg-b' }]));

    await expect(
      getClusterResourceGroupViaGraph('shared', SUBSCRIPTION_ID, 'aksarc')
    ).resolves.toBe('rg-b');
    expect(queryOf()).toContain('microsoft.kubernetes/connectedclusters');
    expect(queryOf()).not.toContain('microsoft.containerservice/managedclusters');
  });

  test('returns null when not found, on invalid input, or when the query fails', async () => {
    mocks.azRequest.mockResolvedValue(page([]));
    await expect(getClusterResourceGroupViaGraph('none', SUBSCRIPTION_ID)).resolves.toBeNull();

    await expect(getClusterResourceGroupViaGraph('bad name', SUBSCRIPTION_ID)).resolves.toBeNull();
    await expect(getClusterResourceGroupViaGraph('ok', 'not-a-guid')).resolves.toBeNull();
    expect(mocks.azRequest).toHaveBeenCalledTimes(1);

    mocks.azRequest.mockRejectedValue(new Error('network'));
    await expect(getClusterResourceGroupViaGraph('ok', SUBSCRIPTION_ID)).resolves.toBeNull();
  });
});

describe('getClusterCount', () => {
  test.each([
    [{ Count: 5 }, 5],
    [{ count_: 3 }, 3],
    [{ Count: 0 }, 0],
  ])('reads the count from %o', async (row, expected) => {
    mocks.azRequest.mockResolvedValue(page([row]));
    await expect(getClusterCount(SUBSCRIPTION_ID)).resolves.toBe(expected);
    expect(mocks.azRequest.mock.calls[0][0].body.subscriptions).toEqual([SUBSCRIPTION_ID]);
  });

  test.each(['not-a-guid', ''])('returns -1 without a request for %j', async subscriptionId => {
    await expect(getClusterCount(subscriptionId)).resolves.toBe(-1);
    expect(mocks.azRequest).not.toHaveBeenCalled();
  });

  test('returns -1 when there is no data or the query fails', async () => {
    mocks.azRequest.mockResolvedValue(page([]));
    await expect(getClusterCount(SUBSCRIPTION_ID)).resolves.toBe(-1);

    mocks.azRequest.mockRejectedValue(new Error('Resource graph query failed'));
    await expect(getClusterCount(SUBSCRIPTION_ID)).resolves.toBe(-1);
  });
});

describe('getManagedNamespacesViaGraph', () => {
  const ns = (id: string) => ({
    id,
    name: `c/${id}`,
    resourceGroup: 'rg',
    subscriptionId: SUBSCRIPTION_ID,
    labels: null,
    provisioningState: 'Succeeded',
  });

  /** Lists the given tenants and returns `rowsByTenant` (an Error value rejects). */
  function mockTenants(rowsByTenant: Record<string, unknown[] | Error>) {
    mocks.azListAll.mockResolvedValue(Object.keys(rowsByTenant).map(tenantId => ({ tenantId })));
    mocks.azRequest.mockImplementation(async ({ tenantId }: { tenantId: string }) => {
      const rows = rowsByTenant[tenantId];
      if (rows instanceof Error) throw rows;
      return page(rows);
    });
  }

  test("queries every tenant with that tenant's token at tenant scope", async () => {
    mockTenants({ [TENANT_A]: [ns('a')], [TENANT_B]: [ns('b')] });
    const signal = new AbortController().signal;

    const result = await getManagedNamespacesViaGraph(signal);

    expect(result).toEqual({ namespaces: [ns('a'), ns('b')], errors: [] });
    expect(mocks.azListAll).toHaveBeenCalledWith({
      ...mocks.cloud,
      url: '/tenants',
      apiVersion: '2022-12-01',
      signal,
    });
    for (const [options] of mocks.azRequest.mock.calls) {
      expect(options.signal).toBe(signal);
      expect(options.body).not.toHaveProperty('subscriptions');
    }
    expect(mocks.azRequest.mock.calls.map(([options]) => options.tenantId)).toEqual([
      TENANT_A,
      TENANT_B,
    ]);
  });

  test('deduplicates namespaces returned by more than one tenant', async () => {
    mockTenants({ [TENANT_A]: [ns('/Shared')], [TENANT_B]: [ns('/shared')] });
    expect((await getManagedNamespacesViaGraph()).namespaces).toHaveLength(1);
  });

  test('skips tenants that fail and reports them', async () => {
    mockTenants({ [TENANT_A]: [ns('a')], [TENANT_B]: new Error('MFA required') });

    await expect(getManagedNamespacesViaGraph()).resolves.toEqual({
      namespaces: [ns('a')],
      errors: [`Tenant ${TENANT_B}: MFA required`],
    });
  });

  test('throws when every tenant fails or tenants cannot be listed', async () => {
    mockTenants({ [TENANT_A]: new Error('login required') });
    await expect(getManagedNamespacesViaGraph()).rejects.toThrow('login required');

    mocks.azListAll.mockRejectedValue(new Error("Please run 'az login'"));
    await expect(getManagedNamespacesViaGraph()).rejects.toThrow("Please run 'az login'");
  });

  test('returns nothing when the account has no tenants', async () => {
    mockTenants({});
    await expect(getManagedNamespacesViaGraph()).resolves.toEqual({ namespaces: [], errors: [] });
  });
});
