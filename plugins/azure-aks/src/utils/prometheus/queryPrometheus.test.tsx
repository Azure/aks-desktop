// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }));

vi.mock('../../azureAuth', () => ({
  azureCredential: { getToken },
}));

import { queryPrometheus } from './queryPrometheus';

describe('queryPrometheus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('waits for the access token before making the request', async () => {
    let resolveToken: (token: { token: string; expiresOnTimestamp: number }) => void;
    getToken.mockReturnValue(
      new Promise(resolve => {
        resolveToken = resolve;
      })
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        status: 'success',
        data: { result: [{ metric: { pod: 'pod-1' } }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = queryPrometheus('https://prometheus.test', 'up', 100, 200);

    expect(fetchMock).not.toHaveBeenCalled();

    resolveToken!({ token: 'prometheus-token', expiresOnTimestamp: Date.now() + 60_000 });
    const result = await resultPromise;

    expect(fetchMock).toHaveBeenCalledWith(
      'https://prometheus.test/api/v1/query_range',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer prometheus-token',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    );
    expect(result).toEqual([{ metric: { pod: 'pod-1' } }]);
  });

  test('does not send a request without a token', async () => {
    getToken.mockResolvedValue({ token: undefined, expiresOnTimestamp: Date.now() + 60_000 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(queryPrometheus('https://prometheus.test', 'up', 100, 200)).resolves.toEqual([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
