// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTokens,
  initiateDeviceFlow,
  isTokenExpired,
  loadTokens,
  refreshAccessToken,
  requestAccessToken,
  saveTokens,
  StoredTokens,
} from './github-auth';

// Mock secure-storage to simulate an environment where secure storage is unavailable
vi.mock('./secure-storage', () => ({
  secureStorageSave: vi.fn().mockResolvedValue(false),
  secureStorageLoad: vi.fn().mockResolvedValue(null),
  secureStorageDelete: vi.fn().mockResolvedValue(false),
}));

/**
 * Helper to mock fetch with a successful JSON response from /externalproxy.
 */
function mockFetchResponse(jsonResponse: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      statusText: 'OK',
      text: () => Promise.resolve(JSON.stringify(jsonResponse)),
    })
  );
}

/**
 * Helper to mock fetch with a non-ok response (e.g. proxy rejection or network error).
 */
function mockFetchFailure(statusText: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      statusText,
      text: () => Promise.resolve(''),
    })
  );
}

describe('github-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initiateDeviceFlow', () => {
    it('should call /externalproxy and return parsed device flow response', async () => {
      mockFetchResponse({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });

      const result = await initiateDeviceFlow();

      expect(fetch).toHaveBeenCalledWith('/externalproxy', {
        method: 'POST',
        headers: {
          'Forward-To': 'https://github.com/login/device/code',
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: expect.any(String),
      });
      expect(result).toEqual({
        deviceCode: 'device-123',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5,
      });
    });

    it('should throw when proxy request fails', async () => {
      mockFetchFailure('Bad Gateway');

      await expect(initiateDeviceFlow()).rejects.toThrow(
        'GitHub OAuth request failed: Bad Gateway'
      );
    });

    it('should throw on empty response body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          statusText: 'OK',
          text: () => Promise.resolve(''),
        })
      );

      await expect(initiateDeviceFlow()).rejects.toThrow('No response from GitHub OAuth endpoint');
    });

    it('should throw on non-JSON response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          statusText: 'OK',
          text: () => Promise.resolve('<html>Not JSON</html>'),
        })
      );

      await expect(initiateDeviceFlow()).rejects.toThrow('Invalid JSON response from GitHub');
    });

    it('should throw on API-level error', async () => {
      mockFetchResponse({
        error: 'unauthorized_client',
        error_description: 'Client ID is not valid',
      });

      await expect(initiateDeviceFlow()).rejects.toThrow(
        'Device flow initiation failed: Client ID is not valid'
      );
    });
  });

  describe('requestAccessToken', () => {
    it('should return tokens on successful authorization', async () => {
      mockFetchResponse({
        access_token: 'ghu_abc123',
        refresh_token: 'ghr_refresh456',
        expires_in: 28800,
      });

      const result = await requestAccessToken('device-123');

      expect(fetch).toHaveBeenCalledWith('/externalproxy', {
        method: 'POST',
        headers: {
          'Forward-To': 'https://github.com/login/oauth/access_token',
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: expect.any(String),
      });
      expect(result).toEqual({
        accessToken: 'ghu_abc123',
        refreshToken: 'ghr_refresh456',
        expiresIn: 28800,
      });
    });

    it('should throw when proxy request fails', async () => {
      mockFetchFailure('Service Unavailable');

      await expect(requestAccessToken('device-123')).rejects.toThrow(
        'GitHub OAuth request failed: Service Unavailable'
      );
    });

    it('should throw authorization_pending while waiting for user', async () => {
      mockFetchResponse({ error: 'authorization_pending' });

      await expect(requestAccessToken('device-123')).rejects.toThrow('authorization_pending');
    });

    it('should throw slow_down when rate limited', async () => {
      mockFetchResponse({ error: 'slow_down' });

      await expect(requestAccessToken('device-123')).rejects.toThrow('slow_down');
    });

    it('should throw expired_token when flow expires', async () => {
      mockFetchResponse({ error: 'expired_token' });

      await expect(requestAccessToken('device-123')).rejects.toThrow('expired_token');
    });

    it('should throw access_denied when user rejects', async () => {
      mockFetchResponse({ error: 'access_denied' });

      await expect(requestAccessToken('device-123')).rejects.toThrow('access_denied');
    });
  });

  describe('refreshAccessToken', () => {
    it('should return new tokens on success', async () => {
      mockFetchResponse({
        access_token: 'ghu_new_token',
        refresh_token: 'ghr_new_refresh',
        expires_in: 28800,
      });

      const result = await refreshAccessToken('ghr_refresh456');

      expect(fetch).toHaveBeenCalledWith('/externalproxy', {
        method: 'POST',
        headers: {
          'Forward-To': 'https://github.com/login/oauth/access_token',
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: expect.any(String),
      });
      expect(result).toEqual({
        accessToken: 'ghu_new_token',
        refreshToken: 'ghr_new_refresh',
        expiresIn: 28800,
      });
    });

    it('should throw when proxy request fails', async () => {
      mockFetchFailure('Gateway Timeout');

      await expect(refreshAccessToken('ghr_refresh456')).rejects.toThrow(
        'GitHub OAuth request failed: Gateway Timeout'
      );
    });

    it('should throw on refresh error', async () => {
      mockFetchResponse({
        error: 'bad_refresh_token',
        error_description: 'The refresh token is invalid',
      });

      await expect(refreshAccessToken('bad-token')).rejects.toThrow(
        'Token refresh failed: The refresh token is invalid'
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
