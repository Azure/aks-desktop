// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetInstallIdCacheForTests, getOrCreateInstallId } from './installId';

const KEY = 'aksdInstallId';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  localStorage.clear();
  __resetInstallIdCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getOrCreateInstallId', () => {
  it('generates a new v4 UUID and persists it when localStorage is empty', () => {
    const id = getOrCreateInstallId();
    expect(id).toMatch(UUID_V4_RE);
    expect(localStorage.getItem(KEY)).toBe(id);
  });

  it('returns the existing UUID when one is already persisted', () => {
    const existing = '11111111-1111-4111-8111-111111111111';
    localStorage.setItem(KEY, existing);
    expect(getOrCreateInstallId()).toBe(existing);
  });

  it('regenerates and overwrites when the stored value is corrupt (non-UUID)', () => {
    localStorage.setItem(KEY, 'garbage');
    const id = getOrCreateInstallId();
    expect(id).toMatch(UUID_V4_RE);
    expect(id).not.toBe('garbage');
    expect(localStorage.getItem(KEY)).toBe(id);
  });

  it('regenerates and overwrites when the stored value is a malformed UUID (wrong version)', () => {
    // v3 UUID — fails the v4 regex check
    localStorage.setItem(KEY, '11111111-1111-3111-8111-111111111111');
    const id = getOrCreateInstallId();
    expect(id).toMatch(UUID_V4_RE);
    expect(localStorage.getItem(KEY)).toBe(id);
  });

  it('returns a stable session UUID when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const id1 = getOrCreateInstallId();
    expect(id1).toMatch(UUID_V4_RE);
    // Consecutive calls return the SAME UUID even when setItem keeps
    // throwing — the in-memory cache holds it for the session.
    const id2 = getOrCreateInstallId();
    expect(id2).toBe(id1);
  });

  it('returns a fresh UUID when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const id = getOrCreateInstallId();
    expect(id).toMatch(UUID_V4_RE);
  });

  it('returns the same UUID on two consecutive calls', () => {
    const first = getOrCreateInstallId();
    const second = getOrCreateInstallId();
    expect(first).toBe(second);
  });
});
