// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { secureStorageDelete, secureStorageLoad, secureStorageSave } from './secure-storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plugin secure storage', () => {
  it('uses the plugin-scoped bridge', async () => {
    const storage = {
      save: vi.fn().mockResolvedValue({ success: true }),
      load: vi.fn().mockResolvedValue({ success: true, value: 'value' }),
      delete: vi.fn().mockResolvedValue({ success: true }),
    };
    vi.stubGlobal('pluginSecureStorage', storage);

    await expect(secureStorageSave('key', 'value')).resolves.toBe(true);
    await expect(secureStorageLoad('key')).resolves.toBe('value');
    await expect(secureStorageDelete('key')).resolves.toBe(true);
    expect(storage.save).toHaveBeenCalledWith('key', 'value');
    expect(storage.load).toHaveBeenCalledWith('key');
    expect(storage.delete).toHaveBeenCalledWith('key');
  });

  it('clears development fallback credentials when the native bridge is unavailable', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('pluginSecureStorage', undefined);
    localStorage.setItem('aks-desktop:github-auth-fallback', '{}');
    try {
      const { clearTokens } = await import('./github-auth');
      await expect(clearTokens()).resolves.toBe(true);
      expect(localStorage.getItem('aks-desktop:github-auth-fallback')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      localStorage.removeItem('aks-desktop:github-auth-fallback');
    }
  });

  it('does not mask a native deletion failure with successful development fallback cleanup', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('pluginSecureStorage', {
      save: vi.fn(),
      load: vi.fn(),
      delete: vi.fn().mockResolvedValue({ success: false }),
    });
    localStorage.setItem('aks-desktop:github-auth-fallback', '{}');
    try {
      const { clearTokens } = await import('./github-auth');
      await expect(clearTokens()).resolves.toBe(false);
      expect(localStorage.getItem('aks-desktop:github-auth-fallback')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      localStorage.removeItem('aks-desktop:github-auth-fallback');
    }
  });

  it('fails closed when the bridge is unavailable', async () => {
    await expect(secureStorageSave('key', 'value')).resolves.toBe(false);
    await expect(secureStorageLoad('key')).resolves.toBeNull();
    await expect(secureStorageDelete('key')).resolves.toBe(false);
  });
});
