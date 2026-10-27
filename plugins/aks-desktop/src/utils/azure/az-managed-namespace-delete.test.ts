// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), command: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { deleteManagedNamespace } from './az-namespaces';

const options = {
  subscriptionId: '11111111-2222-3333-4444-555555555555',
  resourceGroup: 'rg',
  clusterName: 'aks',
  namespaceName: 'project',
  credential: {
    getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600_000 }),
  },
};
const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });
const absent = () => json({ error: { code: 'ResourceNotFound' } }, 404);
const operation = 'https://management.azure.com/operations/delete?api-version=2026-01-01';
beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
  vi.useFakeTimers();
});
afterEach(() => {
  expect(mocks.command).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('managed namespace REST deletion', () => {
  test.each([
    '.',
    '..',
    '../aks',
    '%2e%2e',
    '%2E',
    'bad/name',
    'bad\\name',
    'Uppercase',
    '-start',
    'end-',
    'with.dot',
    'a'.repeat(64),
    '',
    ' spaced ',
  ])('rejects invalid namespace %j before transport or authentication', async namespaceName => {
    expect(await deleteManagedNamespace({ ...options, namespaceName })).toMatchObject({
      success: false,
      error: expect.stringContaining('Invalid Kubernetes namespace name'),
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test.each(['a', 'ns-01', 'a'.repeat(63)])(
    'allows valid namespace %s without changing its target',
    async namespaceName => {
      mocks.fetch.mockResolvedValueOnce(absent());
      expect(await deleteManagedNamespace({ ...options, namespaceName })).toMatchObject({
        success: true,
      });
      expect(String(mocks.fetch.mock.calls[0][0])).toContain(
        `/managedClusters/aks/managedNamespaces/${namespaceName}?api-version=2026-01-01`
      );
      expect(mocks.fetch.mock.calls[0][1].method).toBe('DELETE');
    }
  );

  test.each([
    { resourceGroup: '..' },
    { clusterName: '..' },
    { resourceGroup: '.' },
    { clusterName: '../aks' },
  ])('also rejects unsafe ARM parent coordinates %j', async coordinates => {
    expect(await deleteManagedNamespace({ ...options, ...coordinates })).toMatchObject({
      success: false,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('treats a known absent resource as idempotently deleted', async () => {
    mocks.fetch.mockResolvedValueOnce(absent());
    expect(await deleteManagedNamespace(options)).toMatchObject({ success: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test.each(['NotFound', 'NamespaceNotFound'])(
    'accepts the ContainerService namespace absence code %s after deletion',
    async code => {
      mocks.fetch
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          json({ code, message: 'Could not find the managed namespace' }, 404)
        );
      const result = deleteManagedNamespace(options);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toMatchObject({ success: true });
      mocks.fetch.mockResolvedValueOnce(json({ code }, 404));
      expect(await deleteManagedNamespace(options)).toMatchObject({ success: true });
    }
  );

  test('accepts a missing resource group on initial DELETE', async () => {
    mocks.fetch.mockResolvedValueOnce(json({ error: { code: 'ResourceGroupNotFound' } }, 404));
    expect(await deleteManagedNamespace(options)).toMatchObject({ success: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('accepts group disappearance while polling only when HTTP status is 404', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(json({ error: { code: 'ResourceGroupNotFound' } }, 404));
    const result = deleteManagedNamespace(options);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ success: true });
    mocks.fetch.mockResolvedValueOnce(json({ error: { code: 'ResourceGroupNotFound' } }, 403));
    expect(await deleteManagedNamespace(options)).toMatchObject({ success: false });
  });

  test('observes async completion and absence without modifying the retention policy', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: { 'azure-asyncoperation': operation, 'retry-after': '1' },
        })
      )
      .mockResolvedValueOnce(json({ status: 'InProgress' }))
      .mockResolvedValueOnce(json({ status: 'Succeeded' }))
      .mockResolvedValueOnce(absent());
    const result = deleteManagedNamespace(options);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({ success: true });
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual([
      'DELETE',
      'GET',
      'GET',
      'GET',
    ]);
    expect(mocks.fetch.mock.calls[0][1].body).toBeUndefined();
    expect(String(mocks.fetch.mock.calls[0][0])).toContain(
      '/managedClusters/aks/managedNamespaces/project?api-version=2026-01-01'
    );
  });

  test.each([false, true])(
    'allows a throttled polling GET beyond sixty seconds under the shared deadline (operation URL: %s)',
    async operationUrl => {
      mocks.fetch
        .mockResolvedValueOnce(
          new Response(null, {
            status: 202,
            headers: operationUrl ? { 'azure-asyncoperation': operation } : {},
          })
        )
        .mockResolvedValueOnce(
          json({ error: { code: 'TooManyRequests' } }, 429, { 'retry-after': '120' })
        );
      if (operationUrl) mocks.fetch.mockResolvedValueOnce(json({ status: 'Succeeded' }));
      mocks.fetch.mockResolvedValueOnce(absent());
      const result = deleteManagedNamespace(options);
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(61_000);
      expect(settled).toBe(false);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await result).toMatchObject({ success: true });
      expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(
        operationUrl ? ['DELETE', 'GET', 'GET', 'GET'] : ['DELETE', 'GET', 'GET']
      );
    }
  );

  test('transport throttling still stops at the overall deletion deadline', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        json({ error: { code: 'TooManyRequests' } }, 429, { 'retry-after': '120' })
      );
    const result = deleteManagedNamespace({ ...options, timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('Managed namespace deletion timed out'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('supports Location-only responses and verifies resource disappearance', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { location: operation } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(absent());
    const result = deleteManagedNamespace(options);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ success: true });
  });

  test('polls the single namespace when no operation URL is supplied', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ properties: { provisioningState: 'Deleting' } }))
      .mockResolvedValueOnce(absent());
    const result = deleteManagedNamespace(options);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({ success: true });
    expect(mocks.fetch.mock.calls[1][0].toString()).toBe(mocks.fetch.mock.calls[0][0].toString());
  });

  test.each([403, 409])(
    'surfaces rejected DELETE HTTP %i without retrying writes',
    async status => {
      mocks.fetch.mockResolvedValueOnce(
        json({ error: { code: 'DeletionDenied', message: 'denied' } }, status)
      );
      expect(await deleteManagedNamespace(options)).toMatchObject({
        success: false,
        error: expect.stringContaining('DeletionDenied'),
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    }
  );

  test.each(['Failed', 'Canceled', 'Cancelled'])('surfaces terminal operation %s', async status => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'azure-asyncoperation': operation } })
      )
      .mockResolvedValueOnce(
        json({ status, error: { code: 'DeleteFailed', message: 'locked namespace' } })
      );
    const result = deleteManagedNamespace(options);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('locked namespace'),
    });
  });

  test('does not confuse a missing operation URL with an absent namespace', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'azure-asyncoperation': operation } })
      )
      .mockResolvedValueOnce(absent());
    const result = deleteManagedNamespace(options);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('ResourceNotFound'),
    });
  });

  test('rejects missing operation state rather than treating it as completion', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'azure-asyncoperation': operation } })
      )
      .mockResolvedValueOnce(json({}));
    const result = deleteManagedNamespace(options);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('missing its status'),
    });
  });

  test('enforces one deadline including a long Retry-After', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(null, { status: 202, headers: { 'retry-after': '120' } })
    );
    const result = deleteManagedNamespace({ ...options, timeoutMs: 1500 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('timed out'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('cancels polling without issuing more requests', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 202 }));
    const controller = new AbortController();
    const result = deleteManagedNamespace({ ...options, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error('cancelled'));
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('cancelled'),
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('never follows an operation link to an untrusted host', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 202,
        headers: { 'azure-asyncoperation': 'https://untrusted.example/operation' },
      })
    );
    expect(await deleteManagedNamespace(options)).toMatchObject({
      success: false,
      error: expect.stringContaining('untrusted host'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('rejects Arc before contacting the managed namespace endpoint', async () => {
    expect(await deleteManagedNamespace({ ...options, clusterType: 'aksarc' })).toMatchObject({
      success: false,
      error: expect.stringContaining('Arc'),
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
