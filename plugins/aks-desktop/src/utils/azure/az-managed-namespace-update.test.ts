// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), token: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));
vi.mock('./az-cli-path', () => ({ getAzCommand: () => 'az' }));
vi.mock('./az-token', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-token')>()),
  azCliCredential: { getToken: mocks.token },
}));

import { getManagedNamespaceDetails, updateManagedNamespace } from './az-namespaces';

const scope = {
  subscriptionId: 'subscription',
  resourceGroup: 'group',
  clusterName: 'cluster',
  namespaceName: 'namespace',
};
const resource = () => ({
  id: '/subscriptions/subscription/resourceGroups/group/providers/Microsoft.ContainerService/managedClusters/cluster/managedNamespaces/namespace',
  name: 'namespace',
  type: 'Microsoft.ContainerService/managedClusters/managedNamespaces',
  location: 'eastus',
  eTag: '"version-1"',
  identity: { type: 'SystemAssigned' },
  systemData: { createdBy: 'owner' },
  tags: { team: 'platform' },
  properties: {
    labels: { existing: 'keep', replace: 'old' },
    annotations: { note: 'keep' },
    defaultResourceQuota: {
      cpuRequest: '100m',
      cpuLimit: '2',
      memoryRequest: '128Mi',
      memoryLimit: '2Gi',
    },
    defaultNetworkPolicy: { ingress: 'DenyAll', egress: 'AllowAll' },
    adoptionPolicy: 'Always',
    deletePolicy: 'Keep',
    provisioningState: 'Succeeded',
    portalFqdn: 'readonly',
  },
});
function json(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}
function request(index: number) {
  const [url, init] = mocks.fetch.mock.calls[index];
  return { url: String(url), ...(init as RequestInit) };
}
function body() {
  return JSON.parse(request(1).body as string);
}
function successfulPut(status = 200) {
  mocks.fetch
    .mockResolvedValueOnce(json(200, resource()))
    .mockResolvedValueOnce(json(status, resource()))
    .mockResolvedValueOnce(json(200, resource()));
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.command.mockReset().mockResolvedValue({
    stdout: JSON.stringify({ id: scope.subscriptionId, tenantId: 'target-tenant' }),
    stderr: '',
  });
  mocks.fetch.mockReset();
  mocks.token.mockReset().mockResolvedValue({ token: 'test-token', expiresOnTimestamp: 9e12 });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  // Resource operations must be REST, never Azure CLI resource commands.
  for (const [, args] of mocks.command.mock.calls) {
    expect(args).toEqual([
      'account',
      'show',
      '-o',
      'json',
      ...(args.length === 6 ? ['--subscription', expect.any(String)] : []),
    ]);
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('managed namespace REST update', () => {
  test('returns full ARM details and encodes Unicode path segments', async () => {
    mocks.fetch.mockResolvedValueOnce(json(200, resource()));
    await expect(
      getManagedNamespaceDetails({ ...scope, namespaceName: 'résumé /?#' })
    ).resolves.toEqual(resource());
    expect(request(0).url).toContain('/managedNamespaces/r%C3%A9sum%C3%A9%20%2F%3F%23?');
    expect(request(0).url).toContain('api-version=2026-01-01');
    expect(mocks.command).toHaveBeenCalledExactlyOnceWith('az', [
      'account',
      'show',
      '-o',
      'json',
      '--subscription',
      scope.subscriptionId,
    ]);
    expect(mocks.token).toHaveBeenCalledWith(
      'https://management.azure.com/.default',
      expect.objectContaining({ tenantId: 'target-tenant' })
    );
  });

  test.each(['azure-asyncoperation', 'location'])(
    'uses the target subscription tenant for GET, PUT, %s polling and final GET',
    async header => {
      mocks.token.mockImplementation(async (_scope, options) => ({
        token: options?.tenantId === 'target-tenant' ? 'target-token' : 'default-tenant-token',
        expiresOnTimestamp: 9e12,
      }));
      mocks.fetch
        .mockResolvedValueOnce(json(200, resource()))
        .mockResolvedValueOnce(json(202, undefined, { [header]: '/operations/op' }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
        .mockResolvedValueOnce(json(200, resource()));

      const result = updateManagedNamespace(scope);
      await vi.runAllTimersAsync();
      await expect(result).resolves.toEqual(resource());
      expect(mocks.command).toHaveBeenCalledTimes(1);
      expect(mocks.token).toHaveBeenCalledTimes(4);
      for (let index = 0; index < 4; index++) {
        expect(mocks.token).toHaveBeenNthCalledWith(
          index + 1,
          'https://management.azure.com/.default',
          expect.objectContaining({ tenantId: 'target-tenant' })
        );
        expect(request(index).headers).toMatchObject({ Authorization: 'Bearer target-token' });
      }
    }
  );

  test.each(['', '{malformed', '{"id":"subscription"}'])(
    'aborts before tokens or HTTP when target account resolution fails: %s',
    async stdout => {
      successfulPut();
      mocks.command.mockResolvedValue({ stdout, stderr: '' });
      await expect(updateManagedNamespace(scope)).rejects.toThrow(/Not logged in|parse account/);
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  test('propagates a target subscription lookup error without using the default tenant', async () => {
    mocks.fetch.mockResolvedValueOnce(json(200, resource()));
    mocks.command.mockResolvedValue({
      stdout: '',
      stderr: 'ERROR: The subscription does not exist in this account.',
    });
    await expect(getManagedNamespaceDetails(scope)).rejects.toThrow(/subscription does not exist/);
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('cancels a pending subscription lookup before requesting a token', async () => {
    const controller = new AbortController();
    mocks.command.mockImplementation(() => new Promise(() => {}));
    const result = updateManagedNamespace({ ...scope, signal: controller.signal }).catch(
      error => error
    );
    expect(mocks.command).toHaveBeenCalledTimes(1);
    controller.abort(new Error('account lookup canceled'));
    expect(await result).toMatchObject({ message: 'account lookup canceled' });
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test.each([200, 201])(
    'quota-only %i update preserves writable data and strips read-only data',
    async status => {
      successfulPut(status);
      await updateManagedNamespace({ ...scope, cpuRequest: 250 });
      const current = resource();
      expect(body()).toEqual({
        location: current.location,
        tags: current.tags,
        properties: {
          labels: current.properties.labels,
          annotations: current.properties.annotations,
          defaultResourceQuota: { ...current.properties.defaultResourceQuota, cpuRequest: '250m' },
          defaultNetworkPolicy: current.properties.defaultNetworkPolicy,
          adoptionPolicy: 'Always',
          deletePolicy: 'Keep',
        },
      });
      expect(request(1).method).toBe('PUT');
      expect(request(1).headers).toMatchObject({ 'If-Match': '"version-1"' });
      expect(request(2).method).toBe('GET');
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
    }
  );

  test('merges labels without losing quotas, policy, tags or annotations', async () => {
    successfulPut();
    await updateManagedNamespace({ ...scope, labels: { replace: 'new', project: 'demo' } });
    expect(body().properties).toMatchObject({
      defaultResourceQuota: resource().properties.defaultResourceQuota,
      defaultNetworkPolicy: resource().properties.defaultNetworkPolicy,
      annotations: resource().properties.annotations,
      labels: { existing: 'keep', replace: 'new', project: 'demo' },
    });
  });

  test('converts numeric units including zero and leaves omitted fields unchanged', async () => {
    successfulPut();
    await updateManagedNamespace({
      ...scope,
      cpuRequest: 0,
      cpuLimit: 700,
      memoryRequest: 0,
      memoryLimit: 512,
      ingressPolicy: 'AllowSameNamespace',
    });
    expect(body().properties.defaultResourceQuota).toEqual({
      cpuRequest: '0m',
      cpuLimit: '700m',
      memoryRequest: '0Mi',
      memoryLimit: '512Mi',
    });
    expect(body().properties.defaultNetworkPolicy).toEqual({
      ingress: 'AllowSameNamespace',
      egress: 'AllowAll',
    });
  });

  test.each([403, 404, 409, 412, 500])('aborts on initial GET %i without PUT', async status => {
    mocks.fetch.mockImplementation(() =>
      Promise.resolve(json(status, { error: { code: 'ReadFailed', message: 'read denied' } }))
    );
    const result = updateManagedNamespace(scope).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status, code: 'ReadFailed' });
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  test.each([403, 404, 409, 412, 500])(
    'does not replay PUT %i and retains Azure IDs',
    async status => {
      mocks.fetch.mockResolvedValueOnce(json(200, resource())).mockResolvedValueOnce(
        json(
          status,
          { error: { code: 'UpdateFailed', message: 'conflict' } },
          {
            'x-ms-request-id': 'req',
            'x-ms-correlation-request-id': 'corr',
          }
        )
      );
      await expect(updateManagedNamespace(scope)).rejects.toMatchObject({
        status,
        code: 'UpdateFailed',
        requestId: 'req',
        correlationId: 'corr',
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    }
  );

  test.each([
    undefined,
    {},
    { ...resource(), properties: undefined },
    { ...resource(), location: undefined },
    { ...resource(), properties: { labels: [] } },
    { ...resource(), properties: { defaultResourceQuota: null } },
    { ...resource(), properties: { defaultNetworkPolicy: { ingress: 7 } } },
    { ...resource(), tags: { bad: 7 } },
  ])('rejects malformed or partial initial resource %# without PUT', async value => {
    mocks.fetch.mockResolvedValueOnce(json(200, value));
    await expect(updateManagedNamespace(scope)).rejects.toThrow(/Malformed/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('preserves legacy optional subscription via existing read-only account helper', async () => {
    mocks.command.mockResolvedValue({
      stdout: JSON.stringify({ id: 'legacy', tenantId: 'tenant' }),
      stderr: '',
    });
    mocks.fetch.mockResolvedValueOnce(json(200, resource()));
    await getManagedNamespaceDetails({ ...scope, subscriptionId: undefined });
    expect(request(0).url).toContain('/subscriptions/legacy/');
    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(mocks.token).toHaveBeenCalledWith(
      'https://management.azure.com/.default',
      expect.objectContaining({ tenantId: 'tenant' })
    );
  });

  test.each([200, 201, 202])(
    'noWait submits PUT %i and returns accepted response without final GET',
    async status => {
      const accepted = { accepted: true };
      mocks.fetch
        .mockResolvedValueOnce(json(200, resource()))
        .mockResolvedValueOnce(
          json(status, accepted, { 'azure-asyncoperation': 'https://untrusted.example/op' })
        );
      await expect(updateManagedNamespace({ ...scope, noWait: true })).resolves.toEqual(accepted);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    }
  );

  test('accepts empty noWait response', async () => {
    mocks.fetch.mockResolvedValueOnce(json(200, resource())).mockResolvedValueOnce(json(202));
    await expect(updateManagedNamespace({ ...scope, noWait: true })).resolves.toEqual({});
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test.each([200, 201, 202])(
    'waits on Azure-AsyncOperation for PUT %i then performs final GET',
    async status => {
      mocks.fetch
        .mockResolvedValueOnce(json(200, resource()))
        .mockResolvedValueOnce(
          json(status, undefined, {
            'azure-asyncoperation': '/operations/op?api-version=custom',
            'retry-after': '2',
          })
        )
        .mockResolvedValueOnce(json(200, { status: 'Running' }, { 'retry-after': '3' }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
        .mockResolvedValueOnce(json(200, resource()));
      const result = updateManagedNamespace(scope);
      await vi.advanceTimersByTimeAsync(1999);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(request(2).url).toBe('https://management.azure.com/operations/op?api-version=custom');
      await vi.advanceTimersByTimeAsync(3000);
      await expect(result).resolves.toEqual(resource());
      expect(request(4).url).toBe(request(0).url);
      expect(mocks.fetch).toHaveBeenCalledTimes(5);
    }
  );

  test('honors HTTP-date Retry-After and polls Location resource', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(
        json(202, undefined, {
          location: '/operations/location',
          'retry-after': new Date(Date.now() + 5000).toUTCString(),
        })
      )
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(json(200, resource()));
    const result = updateManagedNamespace(scope);
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual(resource());
    expect(request(2).url).toContain('/operations/location');
  });

  test('polls a Location operation status response and follows same-origin continuation', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(json(202, undefined, { location: '/operations/first' }))
      .mockResolvedValueOnce(json(202, { status: 'Running' }, { location: '/operations/second' }))
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
      .mockResolvedValueOnce(json(200, resource()));
    const result = updateManagedNamespace(scope);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(resource());
    expect(request(3).url).toContain('/operations/second');
  });

  test('continues a Location poll with an empty HTTP 202 response', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(json(202, undefined, { location: '/operations/op' }))
      .mockResolvedValueOnce(json(202))
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
      .mockResolvedValueOnce(json(200, resource()));
    const result = updateManagedNamespace(scope);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(resource());
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
  });

  test('does not silently select a subscription if explicit scope is blank', async () => {
    await expect(updateManagedNamespace({ ...scope, subscriptionId: '' })).rejects.toThrow(
      /requires subscription/
    );
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('reports missing current subscription instead of sending a resource request', async () => {
    mocks.command.mockResolvedValue({ stdout: '', stderr: '' });
    await expect(updateManagedNamespace({ ...scope, subscriptionId: undefined })).rejects.toThrow(
      /Not logged in/
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('a previously aborted signal prevents token and HTTP requests', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already canceled'));
    await expect(updateManagedNamespace({ ...scope, signal: controller.signal })).rejects.toThrow(
      /already canceled/
    );
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('polls the single resource when 201 provisioning is still Updating', async () => {
    const updating = resource();
    updating.properties.provisioningState = 'Updating';
    mocks.fetch
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(json(201, updating))
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(json(200, resource()));
    const result = updateManagedNamespace(scope);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(resource());
    expect(request(2).url).toBe(request(0).url);
  });

  test.each(['Failed', 'Canceled', 'Cancelled', 'Unknown', '', undefined, 7])(
    'rejects terminal, unknown or malformed operation status %s with Azure IDs',
    async status => {
      mocks.fetch
        .mockResolvedValueOnce(json(200, resource()))
        .mockResolvedValueOnce(json(202, undefined, { 'azure-asyncoperation': '/operations/op' }))
        .mockResolvedValueOnce(
          json(
            200,
            {
              status,
              error: { code: 'OperationFailure', message: 'service detail' },
            },
            { 'x-ms-request-id': 'op-req', 'x-ms-correlation-request-id': 'op-corr' }
          )
        );
      const result = updateManagedNamespace(scope).catch(error => error);
      await vi.runAllTimersAsync();
      expect(await result).toMatchObject({
        code: 'OperationFailure',
        requestId: 'op-req',
        correlationId: 'op-corr',
      });
      expect(await result).toMatchObject({ message: expect.stringContaining('service detail') });
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
    }
  );

  test.each([
    'https://untrusted.example/operations/op',
    '//untrusted.example/op',
    'http://management.azure.com/op',
    'https://management.azure.com:8443/op',
    'https://user:password@management.azure.com/op',
    'https://[',
  ])('rejects untrusted continuation %s before acquiring another token', async url => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(json(202, undefined, { 'azure-asyncoperation': url }));
    await expect(updateManagedNamespace(scope)).rejects.toThrow(/untrusted|Invalid operation URL/);
    expect(mocks.token).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('rejects redirected poll host after first operation response', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(json(202, undefined, { 'azure-asyncoperation': '/operations/op' }))
      .mockResolvedValueOnce(
        json(200, { status: 'Running' }, { location: 'https://untrusted.example/op' })
      );
    const result = updateManagedNamespace(scope).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ message: expect.stringMatching(/untrusted/) });
    expect(mocks.token).toHaveBeenCalledTimes(3);
  });

  test('cancels while waiting without further requests', async () => {
    const controller = new AbortController();
    mocks.fetch
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(
        json(202, undefined, { 'azure-asyncoperation': '/operations/op', 'retry-after': '30' })
      );
    const result = updateManagedNamespace({ ...scope, signal: controller.signal }).catch(
      error => error
    );
    await vi.advanceTimersByTimeAsync(1);
    controller.abort(new Error('user canceled'));
    expect(await result).toMatchObject({ message: 'user canceled' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('bounds the entire update including very long Retry-After', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(
        json(202, undefined, { 'azure-asyncoperation': '/operations/op', 'retry-after': '99999' })
      );
    const result = updateManagedNamespace(scope).catch(error => error);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(await result).toMatchObject({ message: expect.stringMatching(/timed out/) });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test.each(['Failed', 'Canceled', 'Updating', 'Unknown', undefined])(
    'requires final single-resource GET to confirm success, not %s',
    async finalState => {
      const final = resource();
      final.properties.provisioningState = finalState as string;
      mocks.fetch
        .mockResolvedValueOnce(json(200, resource()))
        .mockResolvedValueOnce(json(200, resource()))
        .mockResolvedValueOnce(json(200, final));
      await expect(updateManagedNamespace(scope)).rejects.toThrow(/operation|Final|Malformed/);
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
    }
  );

  test('propagates final GET failure instead of reporting successful update', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(json(200, resource()))
      .mockResolvedValueOnce(json(404, { error: { code: 'Gone', message: 'gone' } }));
    await expect(updateManagedNamespace(scope)).rejects.toMatchObject({
      status: 404,
      code: 'Gone',
    });
  });

  test.each([undefined, '"header-version"'])(
    'uses header ETag when present and omits If-Match without any ETag',
    async etag => {
      const current = resource();
      delete (current as Partial<typeof current>).eTag;
      mocks.fetch
        .mockResolvedValueOnce(json(200, current, etag ? { etag } : {}))
        .mockResolvedValueOnce(json(200, resource()));
      await updateManagedNamespace({ ...scope, noWait: true });
      expect((request(1).headers as Record<string, string>)['If-Match']).toBe(etag);
    }
  );
});
