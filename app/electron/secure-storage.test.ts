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

import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isValidKey, readSecureStorageFile, writeSecureStorageFile } from './secure-storage';

describe('isValidKey', () => {
  it('accepts valid alphanumeric keys', () => {
    expect(isValidKey('my-key')).toBe(true);
    expect(isValidKey('my_key')).toBe(true);
    expect(isValidKey('github:token')).toBe(true);
    expect(isValidKey('key123')).toBe(true);
  });

  it('rejects empty key', () => {
    expect(isValidKey('')).toBe(false);
  });

  it('rejects keys with invalid characters', () => {
    expect(isValidKey('key with spaces')).toBe(false);
    expect(isValidKey('key/path')).toBe(false);
    expect(isValidKey('key\nnewline')).toBe(false);
    expect(isValidKey('../traversal')).toBe(false);
  });

  it('rejects keys exceeding max length', () => {
    const longKey = 'a'.repeat(129);
    expect(isValidKey(longKey)).toBe(false);
    const maxKey = 'a'.repeat(128);
    expect(isValidKey(maxKey)).toBe(true);
  });

  it('rejects dangerous prototype keys', () => {
    expect(isValidKey('__proto__')).toBe(false);
    expect(isValidKey('constructor')).toBe(false);
    expect(isValidKey('prototype')).toBe(false);
  });
});

describe('readSecureStorageFile', () => {
  let tmpDir: string;
  let storagePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-storage-test-'));
    storagePath = path.join(tmpDir, 'secure-storage.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty null-prototype object for non-existent file', () => {
    const result = readSecureStorageFile(storagePath);
    expect(Object.keys(result)).toHaveLength(0);
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  it('returns empty null-prototype object for invalid JSON', () => {
    fs.writeFileSync(storagePath, 'not json');
    const result = readSecureStorageFile(storagePath);
    expect(Object.keys(result)).toHaveLength(0);
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  it('returns empty null-prototype object for JSON array', () => {
    fs.writeFileSync(storagePath, '["a","b"]');
    const result = readSecureStorageFile(storagePath);
    expect(Object.keys(result)).toHaveLength(0);
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  it('returns empty null-prototype object for JSON null', () => {
    fs.writeFileSync(storagePath, 'null');
    const result = readSecureStorageFile(storagePath);
    expect(Object.keys(result)).toHaveLength(0);
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  it('filters out non-string values', () => {
    fs.writeFileSync(storagePath, JSON.stringify({ good: 'value', bad: 123, also_bad: null }));
    const result = readSecureStorageFile(storagePath);
    expect(result['good']).toBe('value');
    expect('bad' in result).toBe(false);
    expect('also_bad' in result).toBe(false);
  });

  it('filters out dangerous keys', () => {
    fs.writeFileSync(
      storagePath,
      JSON.stringify({ __proto__: 'evil', constructor: 'evil', safe: 'ok' })
    );
    const result = readSecureStorageFile(storagePath);
    expect('__proto__' in result).toBe(false);
    expect('constructor' in result).toBe(false);
    expect(result['safe']).toBe('ok');
  });

  it('reads valid entries', () => {
    fs.writeFileSync(storagePath, JSON.stringify({ key1: 'enc1', key2: 'enc2' }));
    const result = readSecureStorageFile(storagePath);
    expect(result['key1']).toBe('enc1');
    expect(result['key2']).toBe('enc2');
  });

  it('filters out keys with invalid characters from disk', () => {
    const data: Record<string, string> = {
      'valid-key': 'val',
      'key/with/slashes': 'bad',
    };
    data['a'.repeat(129)] = 'toolong';
    fs.writeFileSync(storagePath, JSON.stringify(data));
    const result = readSecureStorageFile(storagePath);
    expect('valid-key' in result).toBe(true);
    expect('key/with/slashes' in result).toBe(false);
    expect('a'.repeat(129) in result).toBe(false);
  });

  it('returns a null-prototype object', () => {
    fs.writeFileSync(storagePath, JSON.stringify({ key: 'value' }));
    const result = readSecureStorageFile(storagePath);
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  it('returns a null-prototype object for empty/corrupt files', () => {
    const result = readSecureStorageFile(storagePath);
    expect(Object.getPrototypeOf(result)).toBeNull();
  });
});

describe('writeSecureStorageFile', () => {
  let tmpDir: string;
  let storagePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-storage-test-'));
    storagePath = path.join(tmpDir, 'secure-storage.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes data that can be read back', () => {
    const data = { key1: 'value1', key2: 'value2' };
    writeSecureStorageFile(storagePath, data);
    const contents = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    expect(contents).toEqual(data);
  });

  it('overwrites existing file', () => {
    writeSecureStorageFile(storagePath, { old: 'data' });
    writeSecureStorageFile(storagePath, { new: 'data' });
    const contents = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    expect(contents).toEqual({ new: 'data' });
  });

  it('creates file with restricted permissions on non-Windows', () => {
    if (process.platform === 'win32') {
      return;
    }
    writeSecureStorageFile(storagePath, { key: 'value' });
    const stat = fs.statSync(storagePath);
    // The temp file is created with 0o600; after rename the permissions carry over
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('cleans up temp file when rename fails', () => {
    const badPath = path.join(tmpDir, 'nonexistent', 'secure-storage.json');
    expect(() => writeSecureStorageFile(badPath, { key: 'value' })).toThrow();
    const remaining = fs.readdirSync(tmpDir).filter(f => f.includes('.tmp-'));
    expect(remaining).toHaveLength(0);
  });
});
