// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTokens,
  isTokenExpired,
  loadTokens,
  onOAuthCallback,
  refreshAccessToken,
  saveTokens,
  startBrowserOAuth,
  StoredTokens,
} from './github-auth';

// Mock secure-storage to simulate an environment where secure storage is unavailable
vi.mock('./secure-storage', () => ({
  secureStorageSave: vi.fn().mockResolvedValue(false),
  secureStorageLoad: vi.fn().mockResolvedValue(null),
  secureStorageDelete: vi.fn().mockResolvedValue(false),
}));

/**
 * Helper to set up a mock desktopApi on the window object.
 */
function mockDesktopApi(overrides: Record<string, unknown> = {}) {
  const api = {
    startGitHubOAuth: vi.fn().mockResolvedValue({ success: true }),
    onGitHubOAuthCallback: vi.fn().mockReturnValue(() => {}),
    refreshGitHubOAuth: vi.fn().mockResolvedValue({
      success: true,
      accessToken: 'ghu_new_token',
      refreshToken: 'ghr_new_refresh',
      expiresAt: new Date(Date.now() + 28800 * 1000).toISOString(),
    }),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).desktopApi = api;
  return api;
}

describe('github-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).desktopApi;
  });

  describe('startBrowserOAuth', () => {
    it('should call desktopApi.startGitHubOAuth', async () => {
      const api = mockDesktopApi();

      await startBrowserOAuth();

      expect(api.startGitHubOAuth).toHaveBeenCalledOnce();
    });

    it('should throw when startGitHubOAuth returns failure', async () => {
      mockDesktopApi({
        startGitHubOAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'Something went wrong',
        }),
      });

      await expect(startBrowserOAuth()).rejects.toThrow('Something went wrong');
    });

    it('should throw when desktopApi is not available', async () => {
      await expect(startBrowserOAuth()).rejects.toThrow(
        'desktopApi not available — not running in Electron'
      );
    });
  });

  describe('onOAuthCallback', () => {
    it('should call desktopApi.onGitHubOAuthCallback with the provided callback', () => {
      const unsubscribe = vi.fn();
      const api = mockDesktopApi({
        onGitHubOAuthCallback: vi.fn().mockReturnValue(unsubscribe),
      });

      const callback = vi.fn();
      const result = onOAuthCallback(callback);

      expect(api.onGitHubOAuthCallback).toHaveBeenCalledWith(callback);
      expect(result).toBe(unsubscribe);
    });

    it('should throw when desktopApi is not available', () => {
      expect(() => onOAuthCallback(vi.fn())).toThrow(
        'desktopApi not available — not running in Electron'
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('should return new tokens on success', async () => {
      const expiresAt = new Date(Date.now() + 28800 * 1000).toISOString();
      const api = mockDesktopApi({
        refreshGitHubOAuth: vi.fn().mockResolvedValue({
          success: true,
          accessToken: 'ghu_new_token',
          refreshToken: 'ghr_new_refresh',
          expiresAt,
        }),
      });

      const result = await refreshAccessToken('ghr_refresh456');

      expect(api.refreshGitHubOAuth).toHaveBeenCalledWith('ghr_refresh456');
      expect(result.accessToken).toBe('ghu_new_token');
      expect(result.refreshToken).toBe('ghr_new_refresh');
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it('should throw when refresh returns failure', async () => {
      mockDesktopApi({
        refreshGitHubOAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'The refresh token is invalid',
        }),
      });

      await expect(refreshAccessToken('bad-token')).rejects.toThrow(
        'Token refresh failed: The refresh token is invalid'
      );
    });

    it('should throw when desktopApi is not available', async () => {
      await expect(refreshAccessToken('ghr_refresh456')).rejects.toThrow(
        'desktopApi not available — not running in Electron'
      );
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for a past timestamp', () => {
      const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
      expect(isTokenExpired(pastDate)).toBe(true);
    });

    it('should return false for a timestamp well in the future', () => {
      const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
      expect(isTokenExpired(futureDate)).toBe(false);
    });

    it('should return true for current timestamp (expired boundary)', () => {
      const now = new Date().toISOString();
      expect(isTokenExpired(now)).toBe(true);
    });

    it('should return true within the 5-minute safety buffer', () => {
      // Token expires in 3 minutes — within the 5-minute buffer, so considered expired
      const soonDate = new Date(Date.now() + 3 * 60 * 1000).toISOString();
      expect(isTokenExpired(soonDate)).toBe(true);
    });

    it('should return false just outside the 5-minute safety buffer', () => {
      // Token expires in 6 minutes — outside the 5-minute buffer
      const laterDate = new Date(Date.now() + 6 * 60 * 1000).toISOString();
      expect(isTokenExpired(laterDate)).toBe(false);
    });

    it('should return true for an invalid date string', () => {
      expect(isTokenExpired('not-a-date')).toBe(true);
    });
  });

  describe('saveTokens / loadTokens / clearTokens', () => {
    const tokens: StoredTokens = {
      accessToken: 'ghu_abc',
      refreshToken: 'ghr_def',
      expiresAt: '2025-12-31T00:00:00.000Z',
    };

    it('should call secureStorageSave when saving tokens', async () => {
      const { secureStorageSave } = await import('./secure-storage');
      await saveTokens(tokens);
      expect(secureStorageSave).toHaveBeenCalledWith(
        'aks-desktop:github-auth',
        JSON.stringify(tokens)
      );
    });

    it('should return null when secure storage is unavailable', async () => {
      expect(await loadTokens()).toBeNull();
    });

    it('should load tokens from secure storage when available', async () => {
      const { secureStorageLoad } = await import('./secure-storage');
      (secureStorageLoad as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(tokens));

      const result = await loadTokens();
      expect(result).toEqual(tokens);
    });

    it('should return null for corrupted secure storage', async () => {
      const { secureStorageLoad } = await import('./secure-storage');
      (secureStorageLoad as ReturnType<typeof vi.fn>).mockResolvedValueOnce('not-json');

      expect(await loadTokens()).toBeNull();
    });

    it('should return null for invalid token shape in secure storage', async () => {
      const { secureStorageLoad } = await import('./secure-storage');
      (secureStorageLoad as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        JSON.stringify({ accessToken: 'ok' })
      );

      expect(await loadTokens()).toBeNull();
    });

    it('should call secureStorageDelete when clearing tokens', async () => {
      const { secureStorageDelete } = await import('./secure-storage');
      await clearTokens();
      expect(secureStorageDelete).toHaveBeenCalledWith('aks-desktop:github-auth');
    });
  });
});
