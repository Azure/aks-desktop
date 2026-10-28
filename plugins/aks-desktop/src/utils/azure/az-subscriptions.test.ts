// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  azListAll: vi.fn(),
  azRequest: vi.fn(),
  azRequestRaw: vi.fn(),
  clearAzureCloudCache: vi.fn(),
  clearCache: vi.fn(),
  getAzureCloudEndpoints: vi.fn(),
  getSubscriptionCredential: vi.fn(),
  runCommandAsync: vi.fn(),
}));
vi.mock('./az-cli-core', () => ({
  runCommandAsync: mocks.runCommandAsync,
  debugLog: vi.fn(),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unknown error'),
  isValidGuid: (s: string) => /^[0-9a-f-]{36}$/.test(s),
}));

vi.mock('./az-cloud', () => ({
  clearAzureCloudCache: mocks.clearAzureCloudCache,
  getAzureCloudEndpoints: mocks.getAzureCloudEndpoints,
}));
vi.mock('./az-http', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-http')>()),
  azListAll: mocks.azListAll,
  azRequest: mocks.azRequest,
  azRequestRaw: mocks.azRequestRaw,
}));
vi.mock('./az-token', () => ({
  azCliCredential: { clearCache: mocks.clearCache },
  getSubscriptionCredential: mocks.getSubscriptionCredential,
  withAbort: vi.fn(),
}));

import { AzureRequestError } from './az-http';
import {
  createResourceGroup,
  getResourceGroupLocation,
  getSubscriptions,
  resourceGroupExists,
} from './az-subscriptions';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const SUB_ID = '12345678-1234-1234-1234-123456789abc';
const RG = 'my-rg';
const RG_PATH = `/subscriptions/${SUB_ID}/resourceGroups/${RG}`;
const CLOUD = {
  name: 'AzureUSGovernment',
  endpoint: 'https://management.usgovcloudapi.net',
  scope: 'https://management.core.usgovcloudapi.net//.default',
};
const CLOUD_OPTIONS = { endpoint: CLOUD.endpoint, scope: CLOUD.scope };
const SUB_CREDENTIAL = { getToken: vi.fn() };
/** Every resource group request targets the active cloud with the subscription's credential. */
const RG_REQUEST = {
  ...CLOUD_OPTIONS,
  url: RG_PATH,
  apiVersion: '2021-04-01',
  credential: SUB_CREDENTIAL,
};

/** Builds a subscription in the shape `GET /subscriptions` returns. */
const armSub = (id: string, tenantId: string, state = 'Enabled') => ({
  id: `/subscriptions/${id}`,
  subscriptionId: id,
  displayName: `Sub ${id}`,
  tenantId,
  state,
});

/** Routes `/tenants` and per-tenant `/subscriptions` requests. An Error value rejects. */
function mockArm(tenants: any[] | Error, subsByTenant: Record<string, any[] | Error> = {}) {
  mocks.azListAll.mockImplementation(async (options: { url: string; tenantId?: string }) => {
    const result =
      options.url === '/tenants'
        ? tenants
        : options.url === '/subscriptions'
        ? subsByTenant[options.tenantId!] ?? []
        : new Error(`Unexpected request: ${options.url}`);
    if (result instanceof Error) throw result;
    return result;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAzureCloudEndpoints.mockResolvedValue(CLOUD);
  mocks.getSubscriptionCredential.mockReturnValue(SUB_CREDENTIAL);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('getSubscriptions', () => {
  it("lists subscriptions per tenant in the active cloud with that tenant's token", async () => {
    mockArm(
      [
        { tenantId: TENANT_A, displayName: 'Contoso' },
        { tenantId: TENANT_B, displayName: 'Fabrikam' },
      ],
      {
        [TENANT_A]: [armSub('sub-a', TENANT_A)],
        [TENANT_B]: [armSub('sub-b', TENANT_B, 'Disabled')],
      }
    );

    await expect(getSubscriptions()).resolves.toEqual([
      {
        id: 'sub-a',
        name: 'Sub sub-a',
        tenant: TENANT_A,
        tenantName: 'Contoso',
        status: 'Enabled',
        environmentName: CLOUD.name,
      },
      {
        id: 'sub-b',
        name: 'Sub sub-b',
        tenant: TENANT_B,
        tenantName: 'Fabrikam',
        status: 'Disabled',
        environmentName: CLOUD.name,
      },
    ]);
    expect(mocks.getAzureCloudEndpoints).toHaveBeenCalledWith();
    expect(mocks.azListAll).toHaveBeenCalledWith({
      ...CLOUD_OPTIONS,
      url: '/tenants',
      apiVersion: '2022-12-01',
    });
    expect(mocks.azListAll).toHaveBeenCalledWith({
      ...CLOUD_OPTIONS,
      url: '/subscriptions',
      apiVersion: '2022-12-01',
      tenantId: TENANT_B,
    });
  });

  it('fails without ARM requests when the active cloud cannot be read', async () => {
    mocks.getAzureCloudEndpoints.mockRejectedValue(new Error('Azure cloud name is missing'));
    await expect(getSubscriptions()).rejects.toThrow('Azure cloud name is missing');
    expect(mocks.azListAll).not.toHaveBeenCalled();
  });

  it('deduplicates subscriptions returned by more than one tenant', async () => {
    mockArm([{ tenantId: TENANT_A }, { tenantId: TENANT_B }], {
      [TENANT_A]: [armSub('shared', TENANT_A)],
      [TENANT_B]: [armSub('shared', TENANT_A)],
    });

    expect(await getSubscriptions()).toHaveLength(1);
  });

  it('falls back to the tenant domain, then undefined, for tenant names', async () => {
    mockArm(
      [{ tenantId: TENANT_A, defaultDomain: 'contoso.onmicrosoft.com' }, { tenantId: TENANT_B }],
      { [TENANT_A]: [armSub('a', TENANT_A)], [TENANT_B]: [armSub('b', TENANT_B)] }
    );

    const subs = await getSubscriptions();
    expect(subs.map(s => s.tenantName)).toEqual(['contoso.onmicrosoft.com', undefined]);
  });

  it('skips tenants that fail (e.g. MFA required) and returns the rest', async () => {
    mockArm([{ tenantId: TENANT_A }, { tenantId: TENANT_B }], {
      [TENANT_A]: [armSub('a', TENANT_A)],
      [TENANT_B]: new Error('AADSTS50076: MFA required'),
    });

    expect((await getSubscriptions()).map(s => s.id)).toEqual(['a']);
    expect(console.warn).toHaveBeenCalledWith(
      `Skipping subscriptions for tenant ${TENANT_B}:`,
      'AADSTS50076: MFA required'
    );
  });

  it('throws when every tenant fails', async () => {
    mockArm([{ tenantId: TENANT_A }], { [TENANT_A]: new Error('login required') });
    await expect(getSubscriptions()).rejects.toThrow('login required');
  });

  it('throws when tenants cannot be listed', async () => {
    mockArm(new Error("Please run 'az login'"));
    await expect(getSubscriptions()).rejects.toThrow("Please run 'az login'");
  });

  it('returns an empty list when the account has no tenants', async () => {
    mockArm([]);
    await expect(getSubscriptions()).resolves.toEqual([]);
  });

  it('drops cached tokens and cloud metadata and refreshes the CLI profile only on refresh', async () => {
    mockArm([]);
    mocks.runCommandAsync.mockResolvedValue({ stdout: '[]', stderr: '' });
    await getSubscriptions();
    expect(mocks.clearCache).not.toHaveBeenCalled();
    expect(mocks.clearAzureCloudCache).not.toHaveBeenCalled();
    expect(mocks.runCommandAsync).not.toHaveBeenCalled();
    await getSubscriptions(true);
    expect(mocks.clearCache).toHaveBeenCalledTimes(1);
    expect(mocks.clearAzureCloudCache).toHaveBeenCalledTimes(1);
    expect(mocks.runCommandAsync).toHaveBeenCalledWith('az', [
      'account',
      'list',
      '--all',
      '--refresh',
      '--output',
      'json',
    ]);
  });
});

describe('getResourceGroupLocation', () => {
  it('reads the location from GET {group}', async () => {
    mocks.azRequest.mockResolvedValue({ id: RG_PATH, name: RG, location: 'eastus' });

    await expect(
      getResourceGroupLocation({ resourceGroupName: RG, subscriptionId: SUB_ID })
    ).resolves.toBe('eastus');
    expect(mocks.azRequest).toHaveBeenCalledWith(RG_REQUEST);
    expect(mocks.getSubscriptionCredential).toHaveBeenCalledWith(SUB_ID);
  });

  it('throws when the response has no location', async () => {
    mocks.azRequest.mockResolvedValue({ name: RG });
    await expect(
      getResourceGroupLocation({ resourceGroupName: RG, subscriptionId: SUB_ID })
    ).rejects.toThrow(`Resource group '${RG}' returned no location`);
  });

  it('wraps request failures', async () => {
    mocks.azRequest.mockRejectedValue(
      new AzureRequestError('ResourceGroupNotFound: missing (HTTP 404)', { status: 404 })
    );
    await expect(
      getResourceGroupLocation({ resourceGroupName: RG, subscriptionId: SUB_ID })
    ).rejects.toThrow('Failed to get resource group location: ResourceGroupNotFound');
  });

  it.each([
    [{ resourceGroupName: RG, subscriptionId: 'not-a-guid' }, 'Invalid subscription ID format'],
    [{ resourceGroupName: '!!!', subscriptionId: SUB_ID }, 'Invalid resource group name'],
  ])('rejects invalid input without a request: %o', async (options, message) => {
    await expect(getResourceGroupLocation(options)).rejects.toThrow(message);
    expect(mocks.azRequest).not.toHaveBeenCalled();
  });
});

describe('resourceGroupExists', () => {
  it('treats a successful HEAD {group} (204) as present', async () => {
    mocks.azRequestRaw.mockResolvedValue({ status: 204, headers: new Headers(), data: undefined });

    await expect(
      resourceGroupExists({ resourceGroupName: RG, subscriptionId: SUB_ID })
    ).resolves.toEqual({ exists: true });
    expect(mocks.azRequestRaw).toHaveBeenCalledWith({ ...RG_REQUEST, method: 'HEAD' });
  });

  it('treats 404 as absent', async () => {
    mocks.azRequestRaw.mockRejectedValue(new AzureRequestError('Not Found', { status: 404 }));
    await expect(
      resourceGroupExists({ resourceGroupName: RG, subscriptionId: SUB_ID })
    ).resolves.toEqual({ exists: false });
  });

  it.each([
    ['403', new AzureRequestError('AuthorizationFailed (HTTP 403)', { status: 403 })],
    ['network failure', new AzureRequestError('Azure request failed before a response')],
    ['token failure', new Error('Please run az login')],
  ])('reports %s as an error, not as absent', async (_label, failure) => {
    mocks.azRequestRaw.mockRejectedValue(failure);

    const result = await resourceGroupExists({ resourceGroupName: RG, subscriptionId: SUB_ID });
    expect(result.exists).toBe(false);
    expect(result.error).toBe(`Failed to check resource group existence: ${failure.message}`);
  });

  it.each([
    [{ resourceGroupName: RG, subscriptionId: 'bad-id' }, 'Invalid subscription ID'],
    [{ resourceGroupName: '!!!', subscriptionId: SUB_ID }, 'Invalid resource group name'],
  ])('rejects invalid input without a request: %o', async (options, message) => {
    const result = await resourceGroupExists(options);
    expect(result).toEqual({ exists: false, error: expect.stringContaining(message) });
    expect(mocks.azRequestRaw).not.toHaveBeenCalled();
  });
});

describe('createResourceGroup', () => {
  it('PUTs {group} with the location and default createdBy tag', async () => {
    mocks.azRequest.mockResolvedValue({ name: RG, location: 'eastus' });

    await expect(
      createResourceGroup({ resourceGroupName: RG, location: 'eastus', subscriptionId: SUB_ID })
    ).resolves.toEqual({ success: true });
    expect(mocks.azRequest).toHaveBeenCalledWith({
      ...RG_REQUEST,
      method: 'PUT',
      body: { location: 'eastus', tags: { createdBy: 'AKS Desktop' } },
    });
  });

  it('splits tags only at the first "=" and keeps tags without a value', async () => {
    mocks.azRequest.mockResolvedValue({});

    await createResourceGroup({
      resourceGroupName: RG,
      location: 'westus',
      subscriptionId: SUB_ID,
      tags: ['purpose=a=b', 'createdBy=AKS Desktop', 'flag'],
    });
    expect(mocks.azRequest.mock.calls[0][0].body.tags).toEqual({
      purpose: 'a=b',
      createdBy: 'AKS Desktop',
      flag: '',
    });
  });

  it('succeeds when a concurrent caller already created the group', async () => {
    // ARM PUT is create-or-update: an existing group returns 200 instead of 201.
    mocks.azRequest.mockResolvedValue({ name: RG, location: 'eastus' });
    const create = () =>
      createResourceGroup({ resourceGroupName: RG, location: 'eastus', subscriptionId: SUB_ID });

    await expect(Promise.all([create(), create()])).resolves.toEqual([
      { success: true },
      { success: true },
    ]);
  });

  it('returns request failures as errors', async () => {
    mocks.azRequest.mockRejectedValue(
      new AzureRequestError('AuthorizationFailed: denied (HTTP 403)', { status: 403 })
    );

    await expect(
      createResourceGroup({ resourceGroupName: RG, location: 'eastus', subscriptionId: SUB_ID })
    ).resolves.toEqual({
      success: false,
      error: 'Failed to create resource group: AuthorizationFailed: denied (HTTP 403)',
    });
  });

  it.each([
    [{ resourceGroupName: RG, subscriptionId: 'bad-id' }, 'Invalid subscription ID'],
    [{ resourceGroupName: '!!!', subscriptionId: SUB_ID }, 'Invalid resource group name'],
  ])('rejects invalid input without a request: %o', async (options, message) => {
    const result = await createResourceGroup({ ...options, location: 'eastus' });
    expect(result).toEqual({ success: false, error: expect.stringContaining(message) });
    expect(mocks.azRequest).not.toHaveBeenCalled();
  });
});

describe('Azure CLI usage', () => {
  // The active-cloud lookup is mocked; az-cloud.test.ts covers its local `az cloud show` call.
  // Refresh intentionally syncs the CLI profile and is covered by the getSubscriptions tests.
  it('never runs az commands directly', async () => {
    mockArm([{ tenantId: TENANT_A }], { [TENANT_A]: [armSub('a', TENANT_A)] });
    mocks.azRequest.mockResolvedValue({ location: 'eastus' });
    mocks.azRequestRaw.mockResolvedValue({ status: 204, headers: new Headers() });
    const rg = { resourceGroupName: RG, subscriptionId: SUB_ID };

    await getSubscriptions();
    await getResourceGroupLocation(rg);
    await resourceGroupExists(rg);
    await createResourceGroup({ ...rg, location: 'eastus' });

    expect(mocks.runCommandAsync).not.toHaveBeenCalled();
  });
});
