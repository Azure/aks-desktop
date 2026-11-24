// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  clearCache: vi.fn(),
  getSubscriptionCredential: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../azure/az-token', async importOriginal => ({
  ...(await importOriginal<typeof import('../azure/az-token')>()),
  getSubscriptionCredential: (...args: unknown[]) => mocks.getSubscriptionCredential(...args),
}));

import { queryPrometheus } from './queryPrometheus';

describe('queryPrometheus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getToken.mockResolvedValue({ token: 'prom-token', expiresOnTimestamp: 9e12 });
    mocks.getSubscriptionCredential.mockReturnValue({
      getToken: mocks.getToken,
      clearCache: mocks.clearCache,
    });
    vi.stubGlobal('fetch', mocks.fetch);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('acquires a Prometheus-scoped token and posts URL-encoded query_range parameters', async () => {
    const series = [{ metric: { pod: 'p1' }, values: [[100, '1.5']] }];
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'success', data: { result: series } }), { status: 200 })
    );

    const result = await queryPrometheus(
      'https://prom.example.com/',
      'up',
      100,
      200,
      30,
      'sub-123'
    );

    expect(result).toEqual(series);
    expect(mocks.getSubscriptionCredential).toHaveBeenCalledWith('sub-123');
    expect(mocks.getToken).toHaveBeenCalledWith(
      'https://prometheus.monitor.azure.com/.default',
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://prom.example.com/api/v1/query_range',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer prom-token',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    );
    const body = mocks.fetch.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('query')).toBe('up');
    expect(body.get('start')).toBe('100');
    expect(body.get('end')).toBe('200');
    expect(body.get('step')).toBe('30');
  });

  it('clears token cache and retries once on HTTP 401', async () => {
    mocks.getToken
      .mockResolvedValueOnce({ token: 'expired-token', expiresOnTimestamp: 9e12 })
      .mockResolvedValueOnce({ token: 'fresh-token', expiresOnTimestamp: 9e12 });
    mocks.fetch
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'success', data: { result: [] } }), { status: 200 })
      );

    await expect(
      queryPrometheus('https://prom.example.com', 'up', 1, 2, 60, 'sub-123')
    ).resolves.toEqual([]);
    expect(mocks.clearCache).toHaveBeenCalledOnce();
    expect(mocks.clearCache).toHaveBeenCalledWith('https://prometheus.monitor.azure.com/.default');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token');
  });

  it('coordinates a single Prometheus-scoped refresh across concurrent 401 responses', async () => {
    mocks.getToken
      .mockResolvedValueOnce({ token: 'stale-token', expiresOnTimestamp: 9e12 })
      .mockResolvedValueOnce({ token: 'stale-token', expiresOnTimestamp: 9e12 })
      .mockResolvedValueOnce({ token: 'stale-token', expiresOnTimestamp: 9e12 })
      .mockResolvedValueOnce({ token: 'shared-fresh-token', expiresOnTimestamp: 9e12 });

    mocks.fetch.mockImplementation((_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer stale-token') {
        return Promise.resolve(new Response('Unauthorized', { status: 401 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'success', data: { result: [{ metric: {} }] } }), {
          status: 200,
        })
      );
    });

    const results = await Promise.all([
      queryPrometheus('https://prom.example.com', 'q1', 1, 2, 60, 'sub-123'),
      queryPrometheus('https://prom.example.com', 'q2', 1, 2, 60, 'sub-123'),
      queryPrometheus('https://prom.example.com', 'q3', 1, 2, 60, 'sub-123'),
    ]);

    expect(results).toEqual([[{ metric: {} }], [{ metric: {} }], [{ metric: {} }]]);
    expect(mocks.clearCache).toHaveBeenCalledOnce();
    expect(mocks.clearCache).toHaveBeenCalledWith('https://prometheus.monitor.azure.com/.default');
    expect(mocks.getToken).toHaveBeenCalledTimes(4);
    expect(mocks.fetch).toHaveBeenCalledTimes(6);
  });

  it('returns an empty array on auth failure or non-HTTPS endpoint', async () => {
    mocks.getToken.mockRejectedValueOnce(new Error('Token failed'));
    await expect(
      queryPrometheus('https://prom.example.com', 'up', 1, 2, 60, 'sub-123')
    ).resolves.toEqual([]);

    await expect(
      queryPrometheus('http://prom.example.com', 'up', 1, 2, 60, 'sub-123')
    ).resolves.toEqual([]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns an empty array on non-401 HTTP failure and after a single 401 retry fails', async () => {
    mocks.getToken.mockResolvedValue({ token: 'tok', expiresOnTimestamp: 9e12 });
    mocks.fetch.mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

    await expect(
      queryPrometheus('https://prom.example.com', 'up', 1, 2, 60, 'sub-123')
    ).resolves.toEqual([]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.clearCache).not.toHaveBeenCalled();

    mocks.fetch
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('Unauthorized again', { status: 401 }));

    await expect(
      queryPrometheus('https://prom.example.com', 'up', 1, 2, 60, 'sub-123')
    ).resolves.toEqual([]);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.getToken).toHaveBeenCalledTimes(3);
    expect(mocks.clearCache).toHaveBeenCalledTimes(1);
    expect(mocks.clearCache).toHaveBeenCalledWith('https://prometheus.monitor.azure.com/.default');
  });

  it('aborts promptly even when an injected credential ignores abortSignal', async () => {
    const controller = new AbortController();
    const hangingCredential = {
      getToken: vi.fn(() => new Promise<never>(() => {})),
    };

    const pending = queryPrometheus('https://prom.example.com', 'up', 1, 2, 60, 'sub-123', {
      credential: hangingCredential,
      signal: controller.signal,
    });
    controller.abort(new Error('Cancelled'));

    await expect(pending).resolves.toEqual([]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('cleans up without an unhandled rejection when a 401 refresh fails', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      mocks.getToken
        .mockResolvedValueOnce({ token: 'stale-token', expiresOnTimestamp: 9e12 })
        .mockRejectedValueOnce(new Error('Login expired'));
      mocks.fetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      await expect(
        queryPrometheus('https://prom.example.com', 'up', 1, 2, 60, 'sub-123')
      ).resolves.toEqual([]);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
