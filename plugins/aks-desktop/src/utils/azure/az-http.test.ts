// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { TokenCredential } from '@azure/identity';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execCommand: vi.fn(), fetch: vi.fn() }));

vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.execCommand }));
vi.mock('./az-cli-path', () => ({ getAzCommand: () => 'az' }));

import { azListAll, azRequest, azRequestRaw, AzureRequestError } from './az-http';

const credential = {
  getToken: vi.fn<TokenCredential['getToken']>(async () => ({
    token: 'fake-token',
    expiresOnTimestamp: Date.now() + 3600_000,
  })),
} satisfies TokenCredential;

function json(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function lastRequest() {
  const [url, init] = mocks.fetch.mock.calls.at(-1)!;
  return { url: String(url), init: init as RequestInit & { headers: Record<string, string> } };
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.execCommand.mockReset();
  credential.getToken.mockClear();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  // Requests with an injected credential never run `az`.
  expect(mocks.execCommand).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('azRequest', () => {
  test('resolves ARM paths, appends api-version, and authenticates', async () => {
    mocks.fetch.mockResolvedValue(json(200, { id: 'x' }));

    const data = await azRequest<{ id: string }>({
      url: '/subscriptions/sub-1/resourceGroups?$top=5',
      apiVersion: '2021-04-01',
      tenantId: 'tenant-1',
      credential,
    });

    expect(data).toEqual({ id: 'x' });
    const { url, init } = lastRequest();
    expect(url).toBe(
      'https://management.azure.com/subscriptions/sub-1/resourceGroups?%24top=5&api-version=2021-04-01'
    );
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer fake-token');
    expect(credential.getToken).toHaveBeenCalledWith(
      'https://management.azure.com/.default',
      expect.objectContaining({ tenantId: 'tenant-1' })
    );
  });

  test('derives the token scope from an absolute URL host, not the ARM endpoint', async () => {
    mocks.fetch.mockResolvedValue(json(200, {}));
    await azRequest({ url: 'https://graph.microsoft.com/v1.0/users', credential });

    expect(credential.getToken.mock.calls[0][0]).toBe('https://graph.microsoft.com/.default');
  });

  test('derives the token scope from a non-default endpoint (sovereign clouds)', async () => {
    mocks.fetch.mockResolvedValue(json(200, {}));
    await azRequest({ url: '/x', endpoint: 'https://management.usgovcloudapi.net', credential });

    expect(lastRequest().url).toBe('https://management.usgovcloudapi.net/x');
    expect(credential.getToken.mock.calls[0][0]).toBe(
      'https://management.usgovcloudapi.net/.default'
    );
  });

  test('sends JSON bodies', async () => {
    mocks.fetch.mockResolvedValue(json(201, { ok: true }));
    await azRequest({ url: '/r', method: 'PUT', body: { location: 'eastus' }, credential });

    const { init } = lastRequest();
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"location":"eastus"}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  test.each([204, 202])('returns undefined for empty %i responses', async status => {
    mocks.fetch.mockResolvedValue(json(status));
    await expect(azRequest({ url: '/r', method: 'DELETE', credential })).resolves.toBeUndefined();
  });

  test('exposes status and headers through azRequestRaw', async () => {
    mocks.fetch.mockResolvedValue(json(202, undefined, { 'azure-asyncoperation': 'https://op' }));
    const response = await azRequestRaw({ url: '/r', method: 'PUT', body: {}, credential });

    expect(response.status).toBe(202);
    expect(response.headers.get('azure-asyncoperation')).toBe('https://op');
  });

  test('rejects malformed JSON', async () => {
    mocks.fetch.mockResolvedValue(new Response('{not json', { status: 200 }));
    await expect(azRequest({ url: '/r', credential })).rejects.toThrow(/Malformed JSON/);
  });

  test.each([
    [400, 'InvalidParameter'],
    [401, 'InvalidAuthenticationToken'],
    [403, 'AuthorizationFailed'],
    [404, 'ResourceNotFound'],
    [409, 'Conflict'],
  ])('surfaces ARM %i errors with code and request IDs', async (status, code) => {
    mocks.fetch.mockResolvedValue(
      json(
        status,
        { error: { code, message: 'details here' } },
        { 'x-ms-request-id': 'req-1', 'x-ms-correlation-request-id': 'corr-1' }
      )
    );

    const error: any = await azRequest({ url: '/r', credential }).catch(e => e);
    expect(error).toBeInstanceOf(AzureRequestError);
    expect(error).toMatchObject({ status, code, requestId: 'req-1', correlationId: 'corr-1' });
    expect(error.message).toBe(`${code}: details here (HTTP ${status}, request ID req-1)`);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('preserves bare AKS preview error bodies and request diagnostics', async () => {
    mocks.fetch.mockResolvedValue(
      json(
        403,
        { code: 'FeatureNotEnabled', message: 'Upgrade Insights preview is not enabled' },
        { 'x-ms-request-id': 'preview-request' }
      )
    );
    await expect(azRequest({ url: '/r', credential })).rejects.toMatchObject({
      status: 403,
      code: 'FeatureNotEnabled',
      requestId: 'preview-request',
      message: expect.stringContaining('Upgrade Insights preview is not enabled'),
    });
  });

  test('parses ACR-style error arrays and non-JSON error bodies', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json(404, { errors: [{ code: 'NAME_UNKNOWN', message: 'repo missing' }] })
    );
    await expect(azRequest({ url: '/r', credential })).rejects.toMatchObject({
      code: 'NAME_UNKNOWN',
    });

    mocks.fetch.mockResolvedValueOnce(
      new Response('<html>', { status: 404, statusText: 'Not Found' })
    );
    await expect(azRequest({ url: '/r', credential })).rejects.toThrow('Not Found (HTTP 404)');
  });

  test('retries throttled and transient GETs honoring Retry-After', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json(503, {}, { 'retry-after': '0' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(200, { ok: true }));

    vi.useFakeTimers();
    const pending = azRequest({ url: '/r', credential });
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    await expect(pending).resolves.toEqual({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
  });

  test('cancels discarded response bodies before retrying', async () => {
    const throttled = json(429, { error: { code: 'TooManyRequests' } }, { 'retry-after': '0' });
    const cancel = vi.spyOn(throttled.body!, 'cancel');
    mocks.fetch.mockResolvedValueOnce(throttled).mockResolvedValueOnce(json(200, { ok: true }));

    await expect(azRequest({ url: '/r', credential })).resolves.toEqual({ ok: true });
    expect(cancel).toHaveBeenCalled();
  });

  test('times out while reading the response body', async () => {
    mocks.fetch.mockImplementation(async (_url, init: RequestInit) => {
      const response = json(200, {});
      vi.spyOn(response, 'text').mockImplementation(
        () =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
          )
      );
      return response;
    });

    await expect(azRequest({ url: '/r', credential, timeoutMs: 10 })).rejects.toThrow(/timed out/);
  });

  test('rejects when the credential throws synchronously', async () => {
    const throwing: TokenCredential = {
      getToken: () => {
        throw new Error('sync failure');
      },
    };
    await expect(azRequest({ url: '/r', credential: throwing })).rejects.toThrow('sync failure');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('waits the full server Retry-After even beyond the backoff cap', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(429, {}, { 'retry-after': '120' }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    vi.useFakeTimers();
    const pending = azRequest({ url: '/r', credential, timeoutMs: 180_000 });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();

    await expect(pending).resolves.toEqual({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('stops retrying after maxRetries', async () => {
    mocks.fetch.mockImplementation(async () =>
      json(503, { error: { code: 'ServiceUnavailable', message: 'busy' } }, { 'retry-after': '0' })
    );

    await expect(azRequest({ url: '/r', credential, maxRetries: 2 })).rejects.toMatchObject({
      status: 503,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  test.each(['PUT', 'POST', 'PATCH', 'DELETE'] as const)(
    'never replays %s requests',
    async method => {
      mocks.fetch.mockResolvedValue(json(503, {}, { 'retry-after': '0' }));

      await expect(azRequest({ url: '/r', method, body: {}, credential })).rejects.toMatchObject({
        status: 503,
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    }
  );

  test('retries other methods only when maxRetries is set explicitly', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    await expect(
      azRequest({ url: '/r', method: 'POST', body: {}, credential, maxRetries: 1 })
    ).resolves.toEqual({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('propagates caller cancellation', async () => {
    mocks.fetch.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
        )
    );
    const controller = new AbortController();

    const pending = azRequest({ url: '/r', credential, signal: controller.signal });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    controller.abort(new Error('user cancelled'));

    await expect(pending).rejects.toThrow('user cancelled');
  });

  test('times out', async () => {
    mocks.fetch.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
        )
    );
    await expect(azRequest({ url: '/r', credential, timeoutMs: 10 })).rejects.toThrow(/timed out/);
  });

  describe('with a credential that ignores abortSignal', () => {
    const pendingCredential: TokenCredential = { getToken: () => new Promise(() => {}) };

    test('times out', async () => {
      await expect(
        azRequest({ url: '/r', credential: pendingCredential, timeoutMs: 10 })
      ).rejects.toThrow(/timed out/);
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    test('propagates caller cancellation', async () => {
      const controller = new AbortController();
      const pending = azRequest({
        url: '/r',
        credential: pendingCredential,
        signal: controller.signal,
      });
      controller.abort(new Error('user cancelled'));

      await expect(pending).rejects.toThrow('user cancelled');
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });

  test('resolves relative paths without a leading slash against the endpoint', async () => {
    mocks.fetch.mockResolvedValue(json(200, {}));
    await azRequest({ url: 'subscriptions/sub-1/resourceGroups', credential });

    expect(lastRequest().url).toBe(
      'https://management.azure.com/subscriptions/sub-1/resourceGroups'
    );
  });

  test('rejects non-HTTPS URLs before requesting a token', async () => {
    await expect(azRequest({ url: 'http://management.azure.com/x', credential })).rejects.toThrow(
      /HTTPS/
    );
    expect(credential.getToken).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('does not expose the bearer token when fetch rejects a malformed token', async () => {
    const malformed: TokenCredential = {
      getToken: async () => ({ token: 'secret\ntoken', expiresOnTimestamp: Date.now() + 3600_000 }),
    };
    mocks.fetch.mockImplementation(async (url: URL, init: RequestInit) => new Request(url, init));

    await expect(azRequest({ url: '/r', credential: malformed, maxRetries: 0 })).rejects.toThrow(
      /^Azure request failed before a response was received$/
    );
  });

  test('propagates credential failures without calling fetch', async () => {
    const failing: TokenCredential = {
      getToken: async () => {
        throw new Error('login required');
      },
    };
    await expect(azRequest({ url: '/r', credential: failing })).rejects.toThrow('login required');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('azListAll', () => {
  test('follows nextLink across pages', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json(200, {
          value: [1, 2],
          nextLink: 'https://management.azure.com/subs?api-version=1&$skiptoken=abc',
        })
      )
      .mockResolvedValueOnce(json(200, { value: [3] }));

    await expect(azListAll<number>({ url: '/subs', apiVersion: '1', credential })).resolves.toEqual(
      [1, 2, 3]
    );
    expect(String(mocks.fetch.mock.calls[1][0])).toBe(
      'https://management.azure.com/subs?api-version=1&$skiptoken=abc'
    );
  });

  test('follows root-relative nextLink against a custom endpoint', async () => {
    const endpoint = 'https://management.usgovcloudapi.net';
    mocks.fetch
      .mockResolvedValueOnce(
        json(200, { value: [1], nextLink: '/subs?api-version=1&$skiptoken=abc' })
      )
      .mockResolvedValueOnce(json(200, { value: [2] }));

    await expect(azListAll<number>({ url: '/subs', endpoint, credential })).resolves.toEqual([
      1, 2,
    ]);
    expect(String(mocks.fetch.mock.calls[1][0])).toBe(
      `${endpoint}/subs?api-version=1&$skiptoken=abc`
    );
  });

  test('follows root-relative nextLink against an absolute initial URL', async () => {
    const host = 'https://management.usgovcloudapi.net';
    mocks.fetch
      .mockResolvedValueOnce(json(200, { value: [1], nextLink: '/subs?$skiptoken=abc' }))
      .mockResolvedValueOnce(json(200, { value: [2] }));

    await expect(azListAll<number>({ url: `${host}/subs`, credential })).resolves.toEqual([1, 2]);
    expect(String(mocks.fetch.mock.calls[1][0])).toBe(`${host}/subs?$skiptoken=abc`);
  });

  test('rejects list responses whose value is not an array', async () => {
    mocks.fetch.mockResolvedValueOnce(json(200, { value: { id: 'x' } }));
    await expect(azListAll({ url: '/subs', credential })).rejects.toThrow(/not an array/);
  });

  test('refuses to send tokens to a foreign nextLink host', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json(200, { value: [1], nextLink: 'https://evil.example.com/steal' })
    );

    await expect(azListAll({ url: '/subs', credential })).rejects.toThrow(/untrusted host/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
