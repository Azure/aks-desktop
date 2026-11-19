// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { TokenCredential } from '@azure/identity';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  getAzureCloudEndpoints: vi.fn(),
  getSubscriptionCredential: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));
vi.mock('./az-cloud', () => ({ getAzureCloudEndpoints: mocks.getAzureCloudEndpoints }));
vi.mock('./az-token', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-token')>()),
  getSubscriptionCredential: mocks.getSubscriptionCredential,
}));

import {
  type AcrSku,
  createContainerRegistry,
  getContainerRegistries,
  getRegistryRoleAssignmentMode,
} from './az-acr';

const subscriptionId = '11111111-2222-3333-4444-555555555555';
const credential: TokenCredential = {
  getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600_000 }),
};

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  mocks.command.mockReset();
  mocks.fetch.mockReset();
  mocks.getAzureCloudEndpoints.mockReset();
  mocks.getSubscriptionCredential.mockReset();
  mocks.getAzureCloudEndpoints.mockResolvedValue({
    name: 'AzureCloud',
    endpoint: 'https://management.azure.com',
    scope: 'https://management.azure.com/.default',
  });
  mocks.getSubscriptionCredential.mockReturnValue(credential);
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  expect(mocks.command).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getContainerRegistries', () => {
  test('follows pages and preserves the caller registry shape', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(200, {
          value: [
            {
              id:
                `/subscriptions/${subscriptionId}/resourceGroups/first%20group/` +
                'providers/Microsoft.ContainerRegistry/registries/firstregistry',
              name: 'firstregistry',
              location: 'eastus',
              sku: { name: 'Premium' },
              properties: { loginServer: 'firstregistry.azurecr.io' },
            },
          ],
          nextLink:
            `https://management.azure.com/subscriptions/${subscriptionId}/providers/` +
            'Microsoft.ContainerRegistry/registries?api-version=2023-07-01&$skiptoken=next',
        })
      )
      .mockResolvedValueOnce(
        json(200, {
          value: [
            {
              id:
                `/subscriptions/${subscriptionId}/resourceGroups/second/` +
                'providers/Microsoft.ContainerRegistry/registries/secondregistry',
              name: 'secondregistry',
              location: 'westus',
              sku: { name: 'Standard' },
              properties: { loginServer: 'secondregistry.azurecr.io' },
            },
          ],
        })
      );

    await expect(getContainerRegistries(subscriptionId)).resolves.toEqual([
      {
        id:
          `/subscriptions/${subscriptionId}/resourceGroups/first%20group/` +
          'providers/Microsoft.ContainerRegistry/registries/firstregistry',
        name: 'firstregistry',
        resourceGroup: 'first group',
        loginServer: 'firstregistry.azurecr.io',
        location: 'eastus',
        sku: 'Premium',
      },
      {
        id:
          `/subscriptions/${subscriptionId}/resourceGroups/second/` +
          'providers/Microsoft.ContainerRegistry/registries/secondregistry',
        name: 'secondregistry',
        resourceGroup: 'second',
        loginServer: 'secondregistry.azurecr.io',
        location: 'westus',
        sku: 'Standard',
      },
    ]);
    expect(mocks.fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.ContainerRegistry/registries?api-version=2023-07-01`,
      `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.ContainerRegistry/registries?api-version=2023-07-01&$skiptoken=next`,
    ]);
    expect(mocks.getSubscriptionCredential).toHaveBeenCalledWith(subscriptionId);
  });

  test('surfaces authorization denial', async () => {
    mocks.fetch.mockResolvedValue(
      json(403, { error: { code: 'AuthorizationFailed', message: 'denied' } })
    );

    await expect(getContainerRegistries(subscriptionId)).rejects.toThrow(/AuthorizationFailed/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('refuses cross-origin pagination before sending another authenticated request', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json(200, { value: [], nextLink: 'https://untrusted.example/registries' })
    );
    await expect(getContainerRegistries(subscriptionId)).rejects.toThrow(/untrusted host/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('rejects malformed registry list values', async () => {
    mocks.fetch.mockResolvedValueOnce(json(200, { value: {} }));
    await expect(getContainerRegistries(subscriptionId)).rejects.toThrow(/Malformed list response/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([{}, undefined])(
    'rejects a first registry page without a value array: %o',
    async body => {
      mocks.fetch.mockResolvedValueOnce(
        body === undefined ? new Response(null, { status: 204 }) : json(200, body)
      );
      await expect(getContainerRegistries(subscriptionId)).rejects.toThrow(
        /Malformed list response/
      );
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    }
  );

  test.each([{}, undefined])(
    'rejects a later registry page without returning partial inventory: %o',
    async body => {
      mocks.fetch
        .mockResolvedValueOnce(
          json(200, {
            value: [
              {
                id:
                  `/subscriptions/${subscriptionId}/resourceGroups/group/` +
                  'providers/Microsoft.ContainerRegistry/registries/myregistry',
                name: 'myregistry',
                location: 'eastus',
                properties: { loginServer: 'myregistry.azurecr.io' },
              },
            ],
            nextLink: '?api-version=2023-07-01&$skiptoken=next',
          })
        )
        .mockResolvedValueOnce(
          body === undefined ? new Response(null, { status: 204 }) : json(200, body)
        );
      await expect(getContainerRegistries(subscriptionId)).rejects.toThrow(
        /Malformed list response/
      );
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    }
  );

  test('accepts empty value arrays and follows an empty page continuation', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(200, { value: [], nextLink: '?api-version=2023-07-01&$skiptoken=next' })
      )
      .mockResolvedValueOnce(json(200, { value: [] }));
    await expect(getContainerRegistries(subscriptionId)).resolves.toEqual([]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('rejects malformed JSON in a registry list', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{', { status: 200 }));
    await expect(getContainerRegistries(subscriptionId)).rejects.toThrow(/Malformed JSON response/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('createContainerRegistry', () => {
  const options = {
    registryName: 'myregistry',
    resourceGroup: 'my-group',
    subscriptionId,
    location: 'eastus',
  };

  test('bounds cloud discovery by the creation deadline', async () => {
    vi.useFakeTimers();
    mocks.getAzureCloudEndpoints.mockImplementation(
      (_name: string | undefined, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
    );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('Registry creation timed out'),
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('retries creation without waiting for subscription-wide registration', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(409, { error: { code: 'MissingSubscriptionRegistration', message: 'register' } })
      )
      .mockResolvedValueOnce(json(200, { registrationState: 'Registering' }))
      .mockResolvedValueOnce(
        json(200, { id: 'registry-id', properties: { loginServer: 'registry.azurecr.io' } })
      );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['PUT', 'POST', 'PUT']);
    expect(await result).toEqual({
      success: true,
      id: 'registry-id',
      loginServer: 'registry.azurecr.io',
    });
    expect(String(mocks.fetch.mock.calls[1][0])).toBe(
      `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.ContainerRegistry/register?api-version=2021-04-01`
    );
    expect(String(mocks.fetch.mock.calls[2][0])).toBe(String(mocks.fetch.mock.calls[0][0]));
  });

  test('retries creation after registration is accepted without a response body', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(409, { error: { code: 'MissingSubscriptionRegistration', message: 'register' } })
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        json(200, { id: 'registry-id', properties: { loginServer: 'registry.azurecr.io' } })
      );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['PUT', 'POST', 'PUT']);
    expect(await result).toMatchObject({ success: true });
  });

  test('backs off registration retries up to one minute without registering again', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(409, { error: { code: 'MissingSubscriptionRegistration', message: 'register' } })
      )
      .mockResolvedValueOnce(json(200, { registrationState: 'Registering' }))
      .mockImplementation(() =>
        Promise.resolve(
          json(409, { error: { code: 'MissingSubscriptionRegistration', message: 'register' } })
        )
      );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(0);
    const delays = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000];
    for (const [attempt, delay] of delays.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(mocks.fetch).toHaveBeenCalledTimes(3 + attempt);
      if (attempt === delays.length - 1) {
        mocks.fetch.mockResolvedValueOnce(
          json(200, { id: 'registry-id', properties: { loginServer: 'registry.azurecr.io' } })
        );
      }
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.fetch).toHaveBeenCalledTimes(4 + attempt);
    }
    expect(await result).toMatchObject({ success: true });
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(0);
  });

  test('returns provider registration errors without retrying creation', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(409, { error: { code: 'MissingSubscriptionRegistration', message: 'register' } })
      )
      .mockResolvedValueOnce(
        json(403, { error: { code: 'AuthorizationFailed', message: 'denied' } })
      );
    expect(await createContainerRegistry(options)).toMatchObject({
      success: false,
      error: expect.stringContaining('AuthorizationFailed'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('stops registration propagation retries at the creation deadline', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(409, { error: { code: 'MissingSubscriptionRegistration', message: 'register' } })
      )
      .mockResolvedValueOnce(json(200, { registrationState: 'Registering' }))
      .mockImplementation(() =>
        Promise.resolve(
          json(409, { error: { code: 'MissingSubscriptionRegistration', message: 'register' } })
        )
      );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('Registry creation timed out'),
    });
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(0);
    expect(
      mocks.fetch.mock.calls.filter(([, init]) => init.method === 'PUT').length
    ).toBeGreaterThan(1);
  });

  test('does not retry unrelated creation failures while registration propagates', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(409, { error: { code: 'MissingSubscriptionRegistration', message: 'register' } })
      )
      .mockResolvedValueOnce(json(200, { registrationState: 'Registering' }))
      .mockResolvedValueOnce(
        json(409, { error: { code: 'MissingSubscriptionRegistration', message: 'register' } })
      )
      .mockResolvedValueOnce(
        json(403, { error: { code: 'AuthorizationFailed', message: 'denied' } })
      );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('AuthorizationFailed'),
    });
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual([
      'PUT',
      'POST',
      'PUT',
      'PUT',
    ]);
  });

  test.each<AcrSku>(['Basic', 'Standard', 'Premium'])('creates a %s registry', async sku => {
    const id =
      `/subscriptions/${subscriptionId}/resourceGroups/my-group/` +
      'providers/Microsoft.ContainerRegistry/registries/myregistry';
    mocks.fetch.mockResolvedValue(
      json(200, {
        id,
        name: 'myregistry',
        location: 'eastus',
        sku: { name: sku },
        properties: { loginServer: 'myregistry.azurecr.io' },
      })
    );

    await expect(
      createContainerRegistry({
        registryName: 'myregistry',
        resourceGroup: 'my-group',
        subscriptionId,
        location: 'eastus',
        sku,
      })
    ).resolves.toEqual({
      success: true,
      id,
      loginServer: 'myregistry.azurecr.io',
    });

    const [url, init] = mocks.fetch.mock.calls[0];
    expect(String(url)).toBe(
      `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/my-group/providers/Microsoft.ContainerRegistry/registries/myregistry?api-version=2023-07-01`
    );
    expect(init).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ location: 'eastus', sku: { name: sku } }),
    });
  });

  test('accepts a complete synchronous 201 response without an operation URL', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json(201, { id: 'registry-id', properties: { loginServer: 'registry.azurecr.io' } })
    );
    await expect(createContainerRegistry(options)).resolves.toEqual({
      success: true,
      id: 'registry-id',
      loginServer: 'registry.azurecr.io',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    {},
    { id: 'registry-id', properties: {} },
    { id: {}, properties: { loginServer: 'registry.azurecr.io' } },
    { id: 'registry-id', properties: { loginServer: {} } },
  ])('rejects incomplete or malformed synchronous 201 responses: %o', async body => {
    mocks.fetch.mockResolvedValueOnce(json(201, body));
    await expect(createContainerRegistry(options)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('incomplete registry'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('refuses to poll an untrusted operation URL', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json(201, {}, { 'azure-asyncoperation': 'https://untrusted.example/operation' })
    );
    await expect(createContainerRegistry(options)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('untrusted host'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([{}, { status: 42 }, { status: '  ' }])(
    'rejects malformed operation status: %o',
    async body => {
      mocks.fetch
        .mockResolvedValueOnce(
          json(201, {}, { 'azure-asyncoperation': '/operations/create', 'retry-after': '0' })
        )
        .mockResolvedValueOnce(json(200, body));
      await expect(createContainerRegistry(options)).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining('missing its status'),
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    }
  );

  test('allows retry delays longer than one minute while polling', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(201, {}, { 'azure-asyncoperation': '/operations/create', 'retry-after': '0' })
      )
      .mockResolvedValueOnce(json(429, {}, { 'retry-after': '70' }))
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
      .mockResolvedValueOnce(
        json(200, { id: 'registry-id', properties: { loginServer: 'registry.azurecr.io' } })
      );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(70_001);
    expect(await result).toEqual({
      success: true,
      id: 'registry-id',
      loginServer: 'registry.azurecr.io',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
  });

  test('bounds polling retry delays by the overall creation deadline', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(201, {}, { 'azure-asyncoperation': '/operations/create', 'retry-after': '0' })
      )
      .mockResolvedValueOnce(json(429, {}, { 'retry-after': '700' }));
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('Registry creation timed out'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('allows a long retry delay when reading the completed registry', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(201, {}, { 'azure-asyncoperation': '/operations/create', 'retry-after': '0' })
      )
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
      .mockResolvedValueOnce(json(503, {}, { 'retry-after': '70' }))
      .mockResolvedValueOnce(
        json(200, { id: 'registry-id', properties: { loginServer: 'registry.azurecr.io' } })
      );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(70_001);
    expect(await result).toEqual({
      success: true,
      id: 'registry-id',
      loginServer: 'registry.azurecr.io',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
  });

  test('rejects an incomplete registry after asynchronous success', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(201, {}, { 'azure-asyncoperation': '/operations/create', 'retry-after': '0' })
      )
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
      .mockResolvedValueOnce(json(200, { id: 'registry-id' }));
    await expect(createContainerRegistry(options)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('incomplete registry'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  test.each(['Failed', 'Canceled', 'Cancelled'])(
    'rejects resource provisioning state %s after operation success',
    async provisioningState => {
      mocks.fetch
        .mockResolvedValueOnce(
          json(201, {}, { 'azure-asyncoperation': '/operations/create', 'retry-after': '0' })
        )
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
        .mockResolvedValueOnce(
          json(200, {
            id: 'registry-id',
            properties: { loginServer: 'registry.azurecr.io', provisioningState },
          })
        );

      expect(await createContainerRegistry(options)).toMatchObject({
        success: false,
        error: expect.stringContaining(`Registry provisioning failed: ${provisioningState}`),
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
    }
  );

  test('polls resource provisioning after operation success using the resource retry delay', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(201, {}, { 'azure-asyncoperation': '/operations/create', 'retry-after': '0' })
      )
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
      .mockResolvedValueOnce(
        json(
          200,
          {
            id: 'registry-id',
            properties: { loginServer: 'registry.azurecr.io', provisioningState: 'Creating' },
          },
          { 'retry-after': '2' }
        )
      )
      .mockResolvedValueOnce(
        json(200, {
          id: 'registry-id',
          properties: { loginServer: 'registry.azurecr.io', provisioningState: 'Succeeded' },
        })
      );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(1999);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({
      success: true,
      id: 'registry-id',
      loginServer: 'registry.azurecr.io',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(String(mocks.fetch.mock.calls[3][0])).toBe(String(mocks.fetch.mock.calls[0][0]));
  });

  test('bounds resource provisioning after operation success by the creation deadline', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(
        json(201, {}, { 'azure-asyncoperation': '/operations/create', 'retry-after': '0' })
      )
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
      .mockImplementation(() =>
        Promise.resolve(
          json(
            200,
            {
              id: 'registry-id',
              properties: { loginServer: 'registry.azurecr.io', provisioningState: 'Creating' },
            },
            { 'retry-after': '60' }
          )
        )
      );
    const result = createContainerRegistry(options);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('Registry creation timed out'),
    });
  });

  test('waits for asynchronous completion and reads the completed registry', async () => {
    const resource =
      `/subscriptions/${subscriptionId}/resourceGroups/my-group/` +
      'providers/Microsoft.ContainerRegistry/registries/myregistry';
    const operation = 'https://management.azure.com/operations/create-registry?api-version=1';
    mocks.fetch
      .mockResolvedValueOnce(
        json(
          201,
          { id: resource, properties: { provisioningState: 'Creating' } },
          { 'azure-asyncoperation': operation, 'retry-after': '0' }
        )
      )
      .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
      .mockResolvedValueOnce(
        json(200, {
          id: resource,
          name: 'myregistry',
          location: 'eastus',
          sku: { name: 'Basic' },
          properties: { loginServer: 'created.azurecr.io' },
        })
      );

    await expect(
      createContainerRegistry({
        registryName: 'myregistry',
        resourceGroup: 'my-group',
        subscriptionId,
        location: 'eastus',
      })
    ).resolves.toEqual({
      success: true,
      id: resource,
      loginServer: 'created.azurecr.io',
    });
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual([
      'PUT',
      'GET',
      'GET',
      'GET',
    ]);
    expect(String(mocks.fetch.mock.calls[3][0])).toContain(resource);
  });

  test('polls an operation URL returned with HTTP 200', async () => {
    const resource =
      `/subscriptions/${subscriptionId}/resourceGroups/my-group/` +
      'providers/Microsoft.ContainerRegistry/registries/myregistry';
    mocks.fetch
      .mockResolvedValueOnce(
        json(
          200,
          { id: resource, properties: { provisioningState: 'Creating' } },
          { 'azure-asyncoperation': '/operations/create-registry', 'retry-after': '0' }
        )
      )
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
      .mockResolvedValueOnce(
        json(200, {
          id: resource,
          properties: { loginServer: 'created.azurecr.io', provisioningState: 'Succeeded' },
        })
      );

    await expect(createContainerRegistry(options)).resolves.toEqual({
      success: true,
      id: resource,
      loginServer: 'created.azurecr.io',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(String(mocks.fetch.mock.calls[1][0])).toBe(
      'https://management.azure.com/operations/create-registry?api-version=2023-07-01'
    );
  });

  test('waits for resource provisioning to succeed without an operation URL', async () => {
    const resource =
      `/subscriptions/${subscriptionId}/resourceGroups/my-group/` +
      'providers/Microsoft.ContainerRegistry/registries/myregistry';
    mocks.fetch
      .mockResolvedValueOnce(
        json(
          201,
          {
            id: resource,
            properties: { loginServer: 'created.azurecr.io', provisioningState: 'Creating' },
          },
          { 'retry-after': '0' }
        )
      )
      .mockResolvedValueOnce(
        json(200, {
          id: resource,
          properties: { loginServer: 'created.azurecr.io', provisioningState: 'Succeeded' },
        })
      );

    await expect(createContainerRegistry(options)).resolves.toEqual({
      success: true,
      id: resource,
      loginServer: 'created.azurecr.io',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][1].method).toBe('GET');
  });

  test('rejects a failed resource provisioning state without an operation URL', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json(201, {
        id: 'registry-id',
        properties: {
          loginServer: 'registry.azurecr.io',
          provisioningState: 'Failed',
        },
      })
    );

    await expect(createContainerRegistry(options)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Registry provisioning failed: Failed'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('rejects a resource poll response without a provisioning state', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(
          201,
          { id: 'registry-id', properties: { provisioningState: 'Creating' } },
          { 'retry-after': '0' }
        )
      )
      .mockResolvedValueOnce(json(200, { id: 'registry-id' }));

    await expect(createContainerRegistry(options)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('missing its provisioning state'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('returns an asynchronous creation failure', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(
          201,
          {},
          {
            'azure-asyncoperation': 'https://management.azure.com/operations/create',
            'retry-after': '0',
          }
        )
      )
      .mockResolvedValueOnce(
        json(200, {
          status: 'Failed',
          error: { code: 'RegistryCreationFailed', message: 'capacity unavailable' },
        })
      );

    await expect(
      createContainerRegistry({
        registryName: 'myregistry',
        resourceGroup: 'my-group',
        subscriptionId,
        location: 'eastus',
      })
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/RegistryCreationFailed.*capacity unavailable/),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    [409, 'RegistryNameAlreadyExists'],
    [403, 'AuthorizationFailed'],
  ])('surfaces HTTP %i creation errors', async (status, code) => {
    mocks.fetch.mockResolvedValue(json(status, { error: { code, message: 'request rejected' } }));

    await expect(
      createContainerRegistry({
        registryName: 'myregistry',
        resourceGroup: 'my-group',
        subscriptionId,
        location: 'eastus',
      })
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining(code),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('keeps validation local and does not request Azure for invalid names', async () => {
    await expect(
      createContainerRegistry({
        registryName: 'BAD',
        resourceGroup: 'my-group',
        subscriptionId,
        location: 'eastus',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Invalid registry name: Registry name must be 5-50 lowercase alphanumeric characters.',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.getAzureCloudEndpoints).not.toHaveBeenCalled();
  });

  test.each(['team.prod', 'team(prod)', 'équipe-一', '-rg'])(
    'accepts valid ARM resource group %s',
    async resourceGroup => {
      mocks.fetch.mockResolvedValue(
        json(200, { id: '/acr', properties: { loginServer: 'myregistry.azurecr.io' } })
      );
      await expect(
        createContainerRegistry({
          registryName: 'myregistry',
          resourceGroup,
          subscriptionId,
          location: 'eastus',
        })
      ).resolves.toEqual({
        success: true,
        id: '/acr',
        loginServer: 'myregistry.azurecr.io',
      });
    }
  );

  test.each(['team.', 'a/b', 'a'.repeat(91)])(
    'rejects invalid resource group %s without HTTP calls',
    async resourceGroup => {
      await expect(
        createContainerRegistry({
          registryName: 'myregistry',
          resourceGroup,
          subscriptionId,
          location: 'eastus',
        })
      ).resolves.toEqual({
        success: false,
        error: 'Invalid resource group name format',
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );
});

describe('getRegistryRoleAssignmentMode', () => {
  const acrId = `/subscriptions/${subscriptionId}/resourceGroups/my-rg/providers/Microsoft.ContainerRegistry/registries/myacr`;

  test('returns AbacRepositoryPermissions when reported by ARM 2025-11-01', async () => {
    mocks.getAzureCloudEndpoints.mockResolvedValue({
      endpoint: 'https://management.usgovcloudapi.net',
      scope: 'https://management.usgovcloudapi.net/.default',
    });
    mocks.fetch.mockResolvedValue(
      json(200, { properties: { roleAssignmentMode: 'AbacRepositoryPermissions' } })
    );

    await expect(getRegistryRoleAssignmentMode(acrId)).resolves.toBe('AbacRepositoryPermissions');
    expect(mocks.getSubscriptionCredential).toHaveBeenCalledWith(subscriptionId);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(String(mocks.fetch.mock.calls[0][0])).toBe(
      `https://management.usgovcloudapi.net${acrId}?api-version=2025-11-01`
    );
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  test.each([undefined, 'LegacyRegistryPermissions'])(
    'returns LegacyRegistryPermissions when roleAssignmentMode is %s',
    async roleAssignmentMode => {
      mocks.fetch.mockResolvedValue(json(200, { properties: { roleAssignmentMode } }));
      await expect(getRegistryRoleAssignmentMode(acrId)).resolves.toBe('LegacyRegistryPermissions');
    }
  );

  test('rejects malformed ACR resource IDs before calling ARM', async () => {
    await expect(getRegistryRoleAssignmentMode('/invalid/acr')).rejects.toThrow(
      'Invalid ACR resource ID'
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('propagates ARM read failures', async () => {
    mocks.fetch.mockResolvedValue(
      json(403, { error: { code: 'AuthorizationFailed', message: 'Forbidden' } })
    );
    await expect(getRegistryRoleAssignmentMode(acrId)).rejects.toThrow('Forbidden');
  });
});
