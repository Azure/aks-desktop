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

  it('fails closed when the bridge is unavailable', async () => {
    await expect(secureStorageSave('key', 'value')).resolves.toBe(false);
    await expect(secureStorageLoad('key')).resolves.toBeNull();
    await expect(secureStorageDelete('key')).resolves.toBe(false);
  });
});
