/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Portions (c) Microsoft Corp.

import { app, ipcMain, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'path';
import { SECURE_STORAGE_DELETE, SECURE_STORAGE_LOAD, SECURE_STORAGE_SAVE } from './ipc-channels';

export const VALID_KEY_RE = /^[a-zA-Z0-9:_-]+$/;
export const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const MAX_KEY_LENGTH = 128;
export const MAX_VALUE_LENGTH = 64 * 1024; // 64 KB
export const MAX_ENTRIES = 256;

/** Checks whether a storage key is safe to use: alphanumeric with colons/hyphens/underscores, within length limit, and not a dangerous prototype property. */
export function isValidKey(key: string): boolean {
  return VALID_KEY_RE.test(key) && key.length <= MAX_KEY_LENGTH && !DANGEROUS_KEYS.has(key);
}

/**
 * Reads and validates the encrypted storage JSON file. Returns a null-prototype
 * object of string entries, falling back to an empty null-prototype object on
 * missing/corrupt files.
 * @param storagePath - Absolute path to the secure-storage.json file.
 */
export function readSecureStorageFile(storagePath: string): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Object.create(null);
    }
    // Use null-prototype object to prevent prototype pollution
    const result: Record<string, string> = Object.create(null);
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && isValidKey(k)) {
        result[k] = v;
      }
    }
    return result;
  } catch {
    return Object.create(null);
  }
}

/**
 * Atomically writes the storage object to disk using a temp-file + rename
 * pattern with `0o600` permissions.
 * @param storagePath - Absolute path to the secure-storage.json file.
 * @param data - Key-value map of encrypted entries to persist.
 */
export function writeSecureStorageFile(storagePath: string, data: Record<string, string>): void {
  const dir = path.dirname(storagePath);
  const tmpPath = path.join(dir, `secure-storage.json.tmp-${process.pid}-${Date.now()}`);
  const json = JSON.stringify(data);
  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try {
    fs.writeFileSync(fd, json, { encoding: 'utf8' });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmpPath, storagePath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup
    }
    throw error;
  }
}

/**
 * Encrypts `value` with Electron safeStorage and persists it under `key`.
 * Enforces key/value validation, entry limits, and encryption availability.
 * @param storagePath - Absolute path to the secure-storage.json file.
 * @param key - Storage key (alphanumeric, colons, hyphens, underscores).
 * @param value - Plaintext value to encrypt and store (max 64 KB).
 */
export function handleSecureStorageSave(
  storagePath: string,
  key: string,
  value: string
): { success: boolean; error?: string } {
  if (!isValidKey(key)) {
    return { success: false, error: 'Invalid key format' };
  }
  if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) {
    return { success: false, error: 'Value too large or invalid' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: 'encryption-unavailable' };
  }
  const store = readSecureStorageFile(storagePath);
  if (!(key in store) && Object.keys(store).length >= MAX_ENTRIES) {
    return { success: false, error: 'Storage entry limit reached' };
  }
  let encrypted: string;
  try {
    encrypted = safeStorage.encryptString(value).toString('base64');
  } catch {
    return { success: false, error: 'Encryption failed' };
  }
  store[key] = encrypted;
  writeSecureStorageFile(storagePath, store);
  return { success: true };
}

/**
 * Loads and decrypts the value stored under `key`. Returns `{ value: null }`
 * if the key doesn't exist.
 * @param storagePath - Absolute path to the secure-storage.json file.
 * @param key - Storage key to look up.
 */
export function handleSecureStorageLoad(
  storagePath: string,
  key: string
): { success: boolean; value?: string | null; error?: string } {
  if (!isValidKey(key)) {
    return { success: false, error: 'Invalid key format' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: 'encryption-unavailable' };
  }
  const store = readSecureStorageFile(storagePath);
  const encrypted = store[key];
  if (!encrypted) {
    return { success: true, value: null };
  }
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    return { success: true, value: decrypted };
  } catch {
    // Corrupted entry — remove it and return null
    delete store[key];
    writeSecureStorageFile(storagePath, store);
    return { success: true, value: null };
  }
}

/**
 * Removes `key` from the encrypted storage file. No-op if the key doesn't exist.
 * @param storagePath - Absolute path to the secure-storage.json file.
 * @param key - Storage key to remove.
 */
export function handleSecureStorageDelete(
  storagePath: string,
  key: string
): { success: boolean; error?: string } {
  if (!isValidKey(key)) {
    return { success: false, error: 'Invalid key format' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: 'encryption-unavailable' };
  }
  const store = readSecureStorageFile(storagePath);
  if (!(key in store)) {
    return { success: true };
  }
  delete store[key];
  writeSecureStorageFile(storagePath, store);
  return { success: true };
}

/** Registers IPC handlers for secure storage save/load/delete operations. */
export function setupSecureStorageHandlers(): void {
  const storagePath = path.join(app.getPath('userData'), 'secure-storage.json');

  ipcMain.handle(
    SECURE_STORAGE_SAVE,
    async (_event, { key, value }: { key: string; value: string }) => {
      try {
        return handleSecureStorageSave(storagePath, key, value);
      } catch (error) {
        console.error(`Failed to save secure storage key "${key}":`, error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(SECURE_STORAGE_LOAD, async (_event, { key }: { key: string }) => {
    try {
      return handleSecureStorageLoad(storagePath, key);
    } catch (error) {
      console.error(`Failed to load secure storage key "${key}":`, error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(SECURE_STORAGE_DELETE, async (_event, { key }: { key: string }) => {
    try {
      return handleSecureStorageDelete(storagePath, key);
    } catch (error) {
      console.error(`Failed to delete secure storage key "${key}":`, error);
      return { success: false, error: String(error) };
    }
  });
}
