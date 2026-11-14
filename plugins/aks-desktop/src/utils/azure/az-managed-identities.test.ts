// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { TokenCredential } from '@azure/identity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execCommand: vi.fn(),
  fetch: vi.fn(),
  getAzureCloudEndpoints: vi.fn(),
  getSubscriptionCredential: vi.fn(),
}));

vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.execCommand }));
vi.mock('./az-cli-path', () => ({ getAzCommand: () => 'az' }));
vi.mock('./az-cloud', () => ({ getAzureCloudEndpoints: mocks.getAzureCloudEndpoints }));
vi.mock('./az-token', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-token')>()),
  getSubscriptionCredential: mocks.getSubscriptionCredential,
}));

import {
  createManagedIdentity,
  getManagedIdentity,
  listManagedIdentities,
} from './az-managed-identities';

const SUB_ID = '12345678-1234-1234-1234-123456789abc';
const RG = 'identity-rg';
const NAME = 'workload-id';
const CLIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PRINCIPAL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TENANT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLOUD = {
  name: 'AzureUSGovernment',
  endpoint: 'https://management.usgovcloudapi.net',
  scope: 'https://management.core.usgovcloudapi.net//.default',
};
const GROUP_URL = `${CLOUD.endpoint}/subscriptions/${SUB_ID}/resourceGroups/${RG}`;
const LIST_URL = `${GROUP_URL}/providers/Microsoft.ManagedIdentity/userAssignedIdentities`;
const IDENTITY_URL = `${LIST_URL}/${NAME}`;
const IDENTITY = { identityName: NAME, resourceGroup: RG, subscriptionId: SUB_ID };
const IDS = { clientId: CLIENT_ID, principalId: PRINCIPAL_ID, tenantId: TENANT_ID };

const subscriptionCredential = {
  getToken: vi.fn<TokenCredential['getToken']>(async () => ({
    token: 'subscription-token',
    expiresOnTimestamp: Date.now() + 3600_000,
  })),
} satisfies TokenCredential;

function json(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function armError(status: number, code: string) {
  return json(status, { error: { code, message: `${code} message` } });
}

function armIdentity(name = NAME, properties: Record<string, unknown> = IDS) {
  return {
    id:
      `/subscriptions/${SUB_ID}/resourceGroups/${RG}` +
      `/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${name}`,
    name,
    location: 'usgovvirginia',
    properties,
  };
}

function requests() {
  return mocks.fetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    init: init as RequestInit & { headers: Record<string, string> },
  }));
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.execCommand.mockReset();
  subscriptionCredential.getToken.mockClear();
  mocks.getAzureCloudEndpoints.mockReset().mockResolvedValue(CLOUD);
  mocks.getSubscriptionCredential.mockReset().mockReturnValue(subscriptionCredential);
  vi.stubGlobal('fetch', mocks.fetch);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // Identity requests never run az.
  expect(mocks.execCommand).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getManagedIdentity', () => {
  it('reads nested identity IDs from the configured cloud with the subscription credential', async () => {
    mocks.fetch.mockResolvedValue(json(200, armIdentity()));

    await expect(getManagedIdentity(IDENTITY)).resolves.toEqual({ success: true, ...IDS });

    const [{ url, init }] = requests();
    expect(url).toBe(`${IDENTITY_URL}?api-version=2023-01-31`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer subscription-token');
    expect(mocks.getAzureCloudEndpoints).toHaveBeenCalledWith();
    expect(mocks.getSubscriptionCredential).toHaveBeenCalledWith(SUB_ID);
    expect(subscriptionCredential.getToken).toHaveBeenCalledWith(
      CLOUD.scope,
      expect.objectContaining({ tenantId: undefined })
    );
  });

  it.each([
    ['ResourceNotFound', armError(404, 'ResourceNotFound')],
    ['a code-less 404', new Response('Not found', { status: 404 })],
  ])('treats %s as a missing identity', async (_label, response) => {
    mocks.fetch.mockResolvedValue(response);
    await expect(getManagedIdentity(IDENTITY)).resolves.toEqual({
      success: false,
      notFound: true,
    });
  });

  it.each([
    ['missing resource group', armError(404, 'ResourceGroupNotFound'), 'ResourceGroupNotFound'],
    ['missing subscription', armError(404, 'SubscriptionNotFound'), 'SubscriptionNotFound'],
    ['authorization failure', armError(403, 'AuthorizationFailed'), 'AuthorizationFailed'],
  ])('reports a %s as a failure, not as absent', async (_label, response, code) => {
    mocks.fetch.mockResolvedValue(response);
    const result = await getManagedIdentity(IDENTITY);
    expect(result).toEqual({
      success: false,
      error: expect.stringContaining(`Failed to get managed identity: ${code}`),
    });
    expect(result.notFound).toBeUndefined();
  });

  it.each([
    ['missing properties', {}],
    ['missing tenant', { clientId: CLIENT_ID, principalId: PRINCIPAL_ID }],
    ['non-GUID principal', { ...IDS, principalId: 'principal' }],
  ])('rejects an incomplete payload: %s', async (_label, properties) => {
    mocks.fetch.mockResolvedValue(json(200, armIdentity(NAME, properties)));
    await expect(getManagedIdentity(IDENTITY)).resolves.toEqual({
      success: false,
      error: expect.stringContaining('returned incomplete clientId, principalId or tenantId'),
    });
  });

  it('retries throttled reads using Retry-After', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(429, { error: { code: 'TooManyRequests' } }, { 'retry-after': '0' })
      )
      .mockResolvedValueOnce(json(200, armIdentity()));

    await expect(getManagedIdentity(IDENTITY)).resolves.toEqual({ success: true, ...IDS });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('createManagedIdentity', () => {
  it('PUTs the identity in its resource group location with workload-identity tags', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, { location: 'usgovvirginia' }))
      .mockResolvedValueOnce(json(201, armIdentity()));

    await expect(createManagedIdentity(IDENTITY)).resolves.toEqual({ success: true, ...IDS });

    const [group, put] = requests();
    expect(group.url).toBe(`${GROUP_URL}?api-version=2021-04-01`);
    expect(put.url).toBe(`${IDENTITY_URL}?api-version=2023-01-31`);
    expect(put.init.method).toBe('PUT');
    expect(JSON.parse(String(put.init.body))).toEqual({
      location: 'usgovvirginia',
      tags: { purpose: 'workload-identity', createdBy: 'AKS Desktop' },
    });
    expect(put.init.headers.Authorization).toBe('Bearer subscription-token');
  });

  it.each([
    ['no location', json(200, {}), "Resource group 'identity-rg' returned no location"],
    [
      'missing group',
      armError(404, 'ResourceGroupNotFound'),
      'Failed to get resource group location: ResourceGroupNotFound',
    ],
  ])('does not create an identity when its group has %s', async (_label, response, message) => {
    mocks.fetch.mockResolvedValue(response);

    await expect(createManagedIdentity(IDENTITY)).resolves.toEqual({
      success: false,
      error: expect.stringContaining(message),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the identity that won a concurrent create conflict', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, { location: 'usgovvirginia' }))
      .mockResolvedValueOnce(armError(409, 'Conflict'))
      .mockResolvedValueOnce(json(200, armIdentity()));

    await expect(createManagedIdentity(IDENTITY)).resolves.toEqual({ success: true, ...IDS });
    expect(requests().map(({ init }) => init.method)).toEqual(['GET', 'PUT', 'GET']);
  });

  it('reports the conflict when no identity is readable afterwards', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, { location: 'usgovvirginia' }))
      .mockResolvedValueOnce(armError(409, 'Conflict'))
      .mockResolvedValueOnce(armError(404, 'ResourceNotFound'));

    await expect(createManagedIdentity(IDENTITY)).resolves.toEqual({
      success: false,
      error: expect.stringContaining('Failed to create managed identity: Conflict'),
    });
  });

  it('converges concurrent equivalent creates', async () => {
    mocks.fetch.mockImplementation(async (_url, init: RequestInit) =>
      init.method === 'PUT' ? json(200, armIdentity()) : json(200, { location: 'usgovvirginia' })
    );

    await expect(
      Promise.all([createManagedIdentity(IDENTITY), createManagedIdentity(IDENTITY)])
    ).resolves.toEqual([
      { success: true, ...IDS },
      { success: true, ...IDS },
    ]);
  });

  it('reads the identity when a successful PUT omits its IDs', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, { location: 'usgovvirginia' }))
      .mockResolvedValueOnce(json(202))
      .mockResolvedValueOnce(json(200, armIdentity()));

    await expect(createManagedIdentity(IDENTITY)).resolves.toEqual({ success: true, ...IDS });
  });

  it('fails when the PUT and follow-up read are both incomplete', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, { location: 'usgovvirginia' }))
      .mockResolvedValueOnce(json(200, armIdentity(NAME, {})))
      .mockResolvedValueOnce(json(200, armIdentity(NAME, { clientId: CLIENT_ID })));

    await expect(createManagedIdentity(IDENTITY)).resolves.toEqual({
      success: false,
      error: expect.stringContaining('returned incomplete clientId, principalId or tenantId'),
    });
  });

  it('does not automatically retry the write', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, { location: 'usgovvirginia' }))
      .mockResolvedValueOnce(armError(503, 'ServiceUnavailable'));

    await expect(createManagedIdentity(IDENTITY)).resolves.toEqual({
      success: false,
      error: expect.stringContaining('Failed to create managed identity: ServiceUnavailable'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('listManagedIdentities', () => {
  it('follows pages, projects nested IDs and skips incomplete identities', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(200, {
          value: [armIdentity('first')],
          nextLink: `${LIST_URL}?api-version=2023-01-31&$skiptoken=page-2`,
        })
      )
      .mockResolvedValueOnce(
        json(200, {
          value: [
            armIdentity('second', {
              clientId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
              principalId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            }),
            armIdentity('broken', { clientId: CLIENT_ID }),
          ],
        })
      );

    await expect(
      listManagedIdentities({ resourceGroup: RG, subscriptionId: SUB_ID })
    ).resolves.toEqual({
      success: true,
      identities: [
        {
          name: 'first',
          clientId: CLIENT_ID,
          principalId: PRINCIPAL_ID,
          resourceGroup: RG,
        },
        {
          name: 'second',
          clientId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          principalId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          resourceGroup: RG,
        },
      ],
    });
    expect(requests().map(({ url }) => url)).toEqual([
      `${LIST_URL}?api-version=2023-01-31`,
      `${LIST_URL}?api-version=2023-01-31&$skiptoken=page-2`,
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      'Skipping managed identity with incomplete properties:',
      expect.stringContaining('/broken')
    );
  });

  it('fails the whole list when a later page fails', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, { value: [armIdentity()], nextLink: `${LIST_URL}?page=2` }))
      .mockResolvedValueOnce(armError(403, 'AuthorizationFailed'));

    await expect(
      listManagedIdentities({ resourceGroup: RG, subscriptionId: SUB_ID })
    ).resolves.toEqual({
      success: false,
      error: expect.stringContaining('Failed to list managed identities: AuthorizationFailed'),
    });
  });

  it('refuses a nextLink to another host', async () => {
    mocks.fetch.mockResolvedValue(
      json(200, { value: [], nextLink: 'https://attacker.example/next' })
    );

    await expect(
      listManagedIdentities({ resourceGroup: RG, subscriptionId: SUB_ID })
    ).resolves.toEqual({
      success: false,
      error: expect.stringContaining('Refusing to follow nextLink to untrusted host'),
    });
  });
});

describe('input validation', () => {
  it.each([
    () => getManagedIdentity({ ...IDENTITY, subscriptionId: 'bad' }),
    () => getManagedIdentity({ ...IDENTITY, identityName: '../other' }),
    () => createManagedIdentity({ ...IDENTITY, resourceGroup: 'bad/group' }),
    () => listManagedIdentities({ resourceGroup: 'bad/group', subscriptionId: SUB_ID }),
  ])('rejects invalid input before cloud lookup or HTTP', async call => {
    await expect(call()).resolves.toEqual({ success: false, error: expect.any(String) });
    expect(mocks.getAzureCloudEndpoints).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
