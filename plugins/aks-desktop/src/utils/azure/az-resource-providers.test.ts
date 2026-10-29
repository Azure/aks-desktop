// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { TokenCredential } from '@azure/identity';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { registerContainerServiceProvider } from './az-resource-providers';

const credential: TokenCredential = {
  getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600_000 }),
};
const json = (state: string) =>
  new Response(JSON.stringify({ registrationState: state }), { status: 200 });

beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  expect(mocks.command).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('registerContainerServiceProvider', () => {
  test.each(['Registered', 'Registering'])(
    'accepts %s without claiming completion',
    async state => {
      mocks.fetch.mockResolvedValue(json(state));
      await expect(
        registerContainerServiceProvider('selected-sub', { credential })
      ).resolves.toEqual({
        success: true,
        registrationState: state,
      });
      const [url, init] = mocks.fetch.mock.calls[0];
      expect(String(url)).toBe(
        'https://management.azure.com/subscriptions/selected-sub/providers/Microsoft.ContainerService/register?api-version=2021-04-01'
      );
      expect(init.method).toBe('POST');
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    }
  );

  test('accepts an empty asynchronous response', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 202 }));
    expect(await registerContainerServiceProvider('sub', { credential })).toMatchObject({
      success: true,
    });
  });

  test('is idempotent and keeps registration on the selected cloud/subscription', async () => {
    mocks.fetch.mockImplementation(() => json('Registered'));
    const options = { credential, endpoint: 'https://management.usgovcloudapi.net' };
    expect(await registerContainerServiceProvider('sub/one', options)).toMatchObject({
      success: true,
    });
    expect(await registerContainerServiceProvider('sub/one', options)).toMatchObject({
      success: true,
    });
    expect(mocks.fetch.mock.calls.map(([url]) => String(url))).toEqual(
      Array(2).fill(
        'https://management.usgovcloudapi.net/subscriptions/sub%2Fone/providers/Microsoft.ContainerService/register?api-version=2021-04-01'
      )
    );
  });

  test('polls the single provider only when completion is requested', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(json('Registering'))
      .mockResolvedValueOnce(json('Registering'))
      .mockResolvedValueOnce(json('Registered'));
    const result = registerContainerServiceProvider('sub', {
      credential,
      waitUntilRegistered: true,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toEqual({ success: true, registrationState: 'Registered' });
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET', 'GET']);
    expect(String(mocks.fetch.mock.calls[1][0])).toBe(
      'https://management.azure.com/subscriptions/sub/providers/Microsoft.ContainerService?api-version=2021-04-01'
    );
  });

  test('does not poll an already-registered response', async () => {
    mocks.fetch.mockResolvedValue(json('Registered'));
    expect(
      await registerContainerServiceProvider('sub', { credential, waitUntilRegistered: true })
    ).toMatchObject({ success: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('surfaces denial without retrying the write', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'AuthorizationFailed', message: 'denied' } }), {
        status: 403,
      })
    );
    expect(await registerContainerServiceProvider('sub', { credential })).toMatchObject({
      success: false,
      error: expect.stringContaining('AuthorizationFailed'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('bounds polling by one deadline', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(() => json('Registering'));
    const result = registerContainerServiceProvider('sub', {
      credential,
      waitUntilRegistered: true,
      timeoutMs: 1500,
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('timed out'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('cancels registration without issuing another request', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValue(json('Registering'));
    const controller = new AbortController();
    const result = registerContainerServiceProvider('sub', {
      credential,
      signal: controller.signal,
      waitUntilRegistered: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    controller.abort(new Error('subscription changed'));
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining('subscription changed'),
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('requires an explicit subscription without falling back to the CLI account', async () => {
    expect(await registerContainerServiceProvider('', { credential })).toMatchObject({
      success: false,
      error: expect.stringContaining('subscription ID is required'),
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
