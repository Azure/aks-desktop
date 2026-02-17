// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Thin wrapper around Electron's safeStorage IPC bridge.
 * Falls back gracefully when not running in desktop mode.
 */

interface DesktopApiSecureStorage {
  secureStorageSave(key: string, value: string): Promise<{ success: boolean; error?: string }>;
  secureStorageLoad(key: string): Promise<{ success: boolean; value?: string; error?: string }>;
  secureStorageDelete(key: string): Promise<{ success: boolean; error?: string }>;
}

function getDesktopApi(): DesktopApiSecureStorage | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).desktopApi as DesktopApiSecureStorage | undefined;
  if (
    api &&
    typeof api.secureStorageSave === 'function' &&
    typeof api.secureStorageLoad === 'function' &&
    typeof api.secureStorageDelete === 'function'
  ) {
    return api;
  }
  return null;
}

/**
 * Encrypts and persists a value via Electron safeStorage.
 * Returns true on success, false if unavailable or failed.
 */
export const secureStorageSave = async (key: string, value: string): Promise<boolean> => {
  const api = getDesktopApi();
  if (!api) return false;
  try {
    const result = await api.secureStorageSave(key, value);
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
  const api = getDesktopApi();
  if (!api) return null;
  try {
    const result = await api.secureStorageLoad(key);
    if (result.success && result.value !== undefined) {
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
  const api = getDesktopApi();
  if (!api) return false;
  try {
    const result = await api.secureStorageDelete(key);
    return result.success;
  } catch {
    return false;
  }
};
