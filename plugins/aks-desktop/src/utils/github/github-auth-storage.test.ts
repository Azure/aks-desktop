// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tokens = {
  accessToken: 'synthetic-access',
  refreshToken: 'synthetic-refresh',
  expiresAt: '2030-01-01T00:00:00.000Z',
};
const bridge = () => ({
  save: vi.fn().mockResolvedValue({ success: true }),
  load: vi.fn().mockResolvedValue({ success: true, value: null }),
  delete: vi.fn().mockResolvedValue({ success: true }),
});
let storage = bridge();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  storage = bridge();
  vi.stubGlobal('pluginSecureStorage', storage);
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('truthful credential persistence', () => {
  it('reports whether a token save actually persisted', async () => {
    const { saveTokens } = await import('./github-auth');
    await expect(saveTokens(tokens)).resolves.toBe(true);
    storage.save.mockResolvedValueOnce({ success: false });
    await expect(saveTokens(tokens)).resolves.toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('reports durable deletion and uses only the existing host compatibility key', async () => {
    const { clearTokens } = await import('./github-auth');
    await expect(clearTokens()).resolves.toEqual({ success: true });
    expect(storage.delete.mock.calls).toEqual([['aks-desktop:github-auth']]);
  });

  it.each(['failure', 'throw'])('does not claim successful deletion on %s', async failure => {
    if (failure === 'throw')
      storage.delete.mockRejectedValueOnce(new Error('synthetic-private-failure'));
    else storage.delete.mockResolvedValueOnce({ success: false });
    const { clearTokens } = await import('./github-auth');
    await expect(clearTokens()).resolves.toEqual({ success: false, reason: 'storage-failed' });
  });

  it('also removes a known development fallback on a production disconnect, without touching pipeline data', async () => {
    localStorage.setItem('aks-desktop:github-auth-fallback', JSON.stringify(tokens));
    localStorage.setItem('pipeline-fixture', 'preserve-progress');
    const { clearTokens } = await import('./github-auth');
    await expect(clearTokens()).resolves.toEqual({ success: true });
    expect(localStorage.getItem('aks-desktop:github-auth-fallback')).toBeNull();
    expect(localStorage.getItem('pipeline-fixture')).toBe('preserve-progress');
  });

  it('treats an absent desktop backend as unavailable, not proof of absence', async () => {
    vi.stubGlobal('pluginSecureStorage', undefined);
    const { clearTokens } = await import('./github-auth');
    await expect(clearTokens()).resolves.toEqual({ success: false, reason: 'storage-unavailable' });
  });

  it('allows browser-only development fallback and observes fallback removal failure', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('pluginSecureStorage', undefined);
    vi.stubGlobal('desktopApi', undefined);
    const { clearTokens, saveTokens, loadTokens } = await import('./github-auth');
    await expect(saveTokens(tokens)).resolves.toBe(true);
    await expect(loadTokens()).resolves.toEqual(tokens);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    await expect(clearTokens()).resolves.toEqual({ success: false, reason: 'storage-failed' });
    await expect(clearTokens()).resolves.toEqual({ success: true });
    await expect(loadTokens()).resolves.toBeNull();
  });

  it('does not skip missing secure storage just because a development desktop exists', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('pluginSecureStorage', undefined);
    vi.stubGlobal('desktopApi', {});
    const { clearTokens } = await import('./github-auth');
    await expect(clearTokens()).resolves.toEqual({ success: false, reason: 'storage-unavailable' });
  });
});
