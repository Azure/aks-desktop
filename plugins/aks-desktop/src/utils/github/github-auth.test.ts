// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTokenExpired, loadTokens } from './github-auth';
import { secureStorageLoad } from './secure-storage';

vi.mock('./secure-storage', () => ({
  isSecureStorageAvailable: vi.fn().mockReturnValue(true),
  secureStorageSave: vi.fn(),
  secureStorageLoad: vi.fn(),
  secureStorageDelete: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  vi.mocked(secureStorageLoad).mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe('GitHub credential expiry', () => {
  it.each([
    [-3600, true],
    [0, true],
    [180, true],
    [360, false],
    [3600, false],
  ])('handles an expiry %i seconds from now', (seconds, expired) => {
    expect(isTokenExpired(new Date(Date.now() + seconds * 1000).toISOString())).toBe(expired);
  });
  it('treats an invalid timestamp as expired', () => {
    expect(isTokenExpired('not-a-date')).toBe(true);
  });
});

describe('stored credential loading', () => {
  it('returns null when secure storage is unavailable', async () => {
    await expect(loadTokens()).resolves.toBeNull();
  });
  it('loads the existing untagged format without an origin migration', async () => {
    const tokens = {
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
      expiresAt: '2030-01-01T00:00:00Z',
    };
    vi.mocked(secureStorageLoad).mockResolvedValueOnce(JSON.stringify(tokens));
    await expect(loadTokens()).resolves.toEqual(tokens);
  });
  it.each(['not-json', JSON.stringify({ accessToken: 'only-one-field' }), 'null'])(
    'contains malformed stored data',
    async value => {
      vi.mocked(secureStorageLoad).mockResolvedValueOnce(value);
      await expect(loadTokens()).resolves.toBeNull();
    }
  );
});
