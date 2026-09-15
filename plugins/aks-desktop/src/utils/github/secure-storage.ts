// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Thin wrapper around Headlamp's plugin-scoped safeStorage bridge.
 * Falls back gracefully when not running in desktop mode.
 */

interface PluginSecureStorage {
  save(key: string, value: string): Promise<{ success: boolean; error?: string }>;
  load(key: string): Promise<{ success: boolean; value?: string | null; error?: string }>;
  delete(key: string): Promise<{ success: boolean; error?: string }>;
}

declare const pluginSecureStorage: PluginSecureStorage | undefined;

function getSecureStorage(): PluginSecureStorage | null {
  if (
    typeof pluginSecureStorage !== 'undefined' &&
    pluginSecureStorage &&
    typeof pluginSecureStorage.save === 'function' &&
    typeof pluginSecureStorage.load === 'function' &&
    typeof pluginSecureStorage.delete === 'function'
  ) {
    return pluginSecureStorage;
  }
  return null;
}

/**
 * Encrypts and persists a value via Electron safeStorage.
 * Returns true on success, false if unavailable or failed.
 */
export const secureStorageSave = async (key: string, value: string): Promise<boolean> => {
  const api = getSecureStorage();
  if (!api) return false;
  try {
    const result = await api.save(key, value);
    return result.success;
  } catch {
    return false;
  }
};

/**
 * Loads and decrypts a value from Electron safeStorage.
 * Returns the plaintext string, or null if unavailable/not found/failed.
 */
export const secureStorageLoad = async (key: string): Promise<string | null> => {
  const api = getSecureStorage();
  if (!api) return null;
  try {
    const result = await api.load(key);
    if (result.success && result.value !== undefined && result.value !== null) {
      return result.value;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Deletes a value from Electron safeStorage.
 * Returns true on success, false if unavailable or failed.
 */
export const secureStorageDelete = async (key: string): Promise<boolean> => {
  const api = getSecureStorage();
  if (!api) return false;
  try {
    const result = await api.delete(key);
    return result.success;
  } catch {
    return false;
  }
};
