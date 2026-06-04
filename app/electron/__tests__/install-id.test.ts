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

// Licensed under the Apache 2.0.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getOrCreateInstallId } from '../install-id';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'installid-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getOrCreateInstallId', () => {
  it('creates installId.json with a v4 UUID on first call', () => {
    const id = getOrCreateInstallId(tmpDir);
    expect(id).toMatch(UUID_V4_RE);
    const file = JSON.parse(fs.readFileSync(path.join(tmpDir, 'installId.json'), 'utf8'));
    expect(file.installId).toBe(id);
    expect(typeof file.createdAt).toBe('string');
  });

  it('returns the same UUID across calls', () => {
    const first = getOrCreateInstallId(tmpDir);
    const second = getOrCreateInstallId(tmpDir);
    expect(second).toBe(first);
  });

  it('regenerates when the file is missing', () => {
    const first = getOrCreateInstallId(tmpDir);
    fs.unlinkSync(path.join(tmpDir, 'installId.json'));
    const second = getOrCreateInstallId(tmpDir);
    expect(second).not.toBe(first);
    expect(second).toMatch(UUID_V4_RE);
  });

  it('regenerates when the file is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, 'installId.json'), 'not-json');
    const id = getOrCreateInstallId(tmpDir);
    expect(id).toMatch(UUID_V4_RE);
  });

  it('regenerates when the stored value is not a valid UUID', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'installId.json'),
      JSON.stringify({ installId: 'garbage', createdAt: '2026-01-01' })
    );
    const id = getOrCreateInstallId(tmpDir);
    expect(id).toMatch(UUID_V4_RE);
    expect(id).not.toBe('garbage');
  });

  it('regenerates when the stored value is a non-v4 UUID', () => {
    // Well-formed v1 UUID: version nibble is 1, not 4.
    fs.writeFileSync(
      path.join(tmpDir, 'installId.json'),
      JSON.stringify({
        installId: 'c232ab00-9414-11ec-b3c8-9f6bdeced846',
        createdAt: '2026-01-01',
      })
    );
    const id = getOrCreateInstallId(tmpDir);
    expect(id).toMatch(UUID_V4_RE);
    expect(id).not.toBe('c232ab00-9414-11ec-b3c8-9f6bdeced846');
  });

  it('writes the file with restrictive permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    getOrCreateInstallId(tmpDir);
    const stat = fs.statSync(path.join(tmpDir, 'installId.json'));
    // Mask to permission bits; expect 0600.
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
