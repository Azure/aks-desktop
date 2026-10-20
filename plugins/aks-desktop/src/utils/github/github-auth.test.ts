// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubAuthProvider,
  useGitHubAuthContext,
} from '../../components/GitHubPipeline/GitHubAuthContext';
import { useGitHubAuth } from '../../components/GitHubPipeline/hooks/useGitHubAuth';
import { usePreviewFeatures } from '../../hooks/usePreviewFeatures';
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

vi.mock('./github-api', () => ({
  createOctokitClient: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: vi.fn(() => ({ githubPipelines: false })),
}));

/**
 * Simulates the private OAuth facade injected into the authorized plugin.
 */
function mockOAuthCapability(overrides: Record<string, unknown> = {}) {
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
  vi.stubGlobal('pluginGitHubOAuth', api);
  return api;
}

describe('github-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePreviewFeatures).mockReturnValue({ githubPipelines: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not use the global OAuth bridge even when it is available', async () => {
    const globalStart = vi.fn();
    const globalSubscribe = vi.fn();
    const globalRefresh = vi.fn();
    Object.assign(window, {
      desktopApi: {
        startGitHubOAuth: globalStart,
        onGitHubOAuthCallback: globalSubscribe,
        refreshGitHubOAuth: globalRefresh,
      },
    });
    try {
      await expect(startBrowserOAuth()).rejects.toThrow('not available');
      onOAuthCallback(vi.fn())();
      await expect(refreshAccessToken('synthetic-refresh-token')).rejects.toThrow('not available');
      expect(globalStart).not.toHaveBeenCalled();
      expect(globalSubscribe).not.toHaveBeenCalled();
      expect(globalRefresh).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window, 'desktopApi');
    }
  });

  describe('startBrowserOAuth', () => {
    it.each(['startGitHubOAuth', 'onGitHubOAuthCallback'])(
      'reports unavailable authentication when %s is absent',
      async method => {
        const api = mockOAuthCapability({ [method]: undefined });
        await expect(startBrowserOAuth()).rejects.toThrow(
          'GitHub browser authentication is not available in this desktop build.'
        );
        if (typeof api.startGitHubOAuth === 'function') {
          expect(api.startGitHubOAuth).not.toHaveBeenCalled();
        }
      }
    );

    it('uses the injected sign-in method', async () => {
      const api = mockOAuthCapability();

      await startBrowserOAuth();

      expect(api.startGitHubOAuth).toHaveBeenCalledOnce();
    });

    it('should throw when startGitHubOAuth returns failure', async () => {
      mockOAuthCapability({
        startGitHubOAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'Something went wrong',
        }),
      });

      await expect(startBrowserOAuth()).rejects.toThrow('Something went wrong');
    });

    it('fails closed when the private capability is not injected', async () => {
      await expect(startBrowserOAuth()).rejects.toThrow(
        'GitHub browser authentication is not available in this desktop build.'
      );
    });
  });

  describe('onOAuthCallback', () => {
    it('does not crash project creation when the host has no GitHub OAuth bridge', () => {
      mockOAuthCapability({ onGitHubOAuthCallback: undefined });
      const unsubscribe = onOAuthCallback(vi.fn());
      expect(unsubscribe).toBeTypeOf('function');
      expect(() => unsubscribe()).not.toThrow();
    });

    it('subscribes through the injected facade with the provided callback', () => {
      const unsubscribe = vi.fn();
      const api = mockOAuthCapability({
        onGitHubOAuthCallback: vi.fn().mockReturnValue(unsubscribe),
      });

      const callback = vi.fn();
      const result = onOAuthCallback(callback);

      expect(api.onGitHubOAuthCallback).toHaveBeenCalledWith(callback);
      expect(result).toBe(unsubscribe);
    });

    it('returns a no-op subscription when the private capability is unavailable', () => {
      expect(onOAuthCallback(vi.fn())).toBeTypeOf('function');
    });
  });

  describe('refreshAccessToken', () => {
    it('reports unavailable refresh when the facade lacks the refresh method', async () => {
      mockOAuthCapability({ refreshGitHubOAuth: undefined });
      await expect(refreshAccessToken('synthetic-refresh-token')).rejects.toThrow(
        'GitHub token refresh is not available in this desktop build.'
      );
    });
    it('should return new tokens on success', async () => {
      const expiresAt = new Date(Date.now() + 28800 * 1000).toISOString();
      const api = mockOAuthCapability({
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
      mockOAuthCapability({
        refreshGitHubOAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'The refresh token is invalid',
        }),
      });

      await expect(refreshAccessToken('bad-token')).rejects.toThrow(
        'Token refresh failed: The refresh token is invalid'
      );
    });

    it('fails refresh closed when the private capability is not injected', async () => {
      await expect(refreshAccessToken('ghr_refresh456')).rejects.toThrow(
        'GitHub token refresh is not available in this desktop build.'
      );
    });
  });

  it('mounts the project auth hook on current Headlamp and contains unavailable login errors', async () => {
    mockOAuthCapability({
      startGitHubOAuth: undefined,
      onGitHubOAuthCallback: undefined,
      refreshGitHubOAuth: undefined,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.authState.isRestoring).toBe(false));
    expect(result.current.authState.error).toBeNull();
    await act(async () => {
      await result.current.startOAuth();
    });
    expect(result.current.authState.isAuthorizingBrowser).toBe(false);
    expect(result.current.authState.error).toBe(
      'GitHub browser authentication is not available in this desktop build.'
    );
    expect(consoleError).toHaveBeenCalledOnce();
    unmount();
  });

  it('unsubscribes the project auth hook from its private OAuth facade', async () => {
    const unsubscribe = vi.fn();
    mockOAuthCapability({ onGitHubOAuthCallback: vi.fn().mockReturnValue(unsubscribe) });
    const { result, unmount } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.authState.isRestoring).toBe(false));
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not initialize GitHub auth or mount pipeline UI while the feature is disabled', async () => {
    const { secureStorageLoad } = await import('./secure-storage');
    const child = vi.fn(() => null);
    const view = render(createElement(GitHubAuthProvider, null, createElement(child)));
    expect(child).not.toHaveBeenCalled();
    expect(secureStorageLoad).not.toHaveBeenCalled();
    view.unmount();
  });

  it('mounts auth on enable and unsubscribes and unmounts pipeline UI on disable', async () => {
    const { secureStorageLoad } = await import('./secure-storage');
    const unsubscribe = vi.fn();
    const api = mockOAuthCapability({
      onGitHubOAuthCallback: vi.fn().mockReturnValue(unsubscribe),
    });
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function PipelineChild() {
      const { authState } = useGitHubAuthContext();
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return createElement('span', null, authState.isRestoring ? 'Restoring' : 'Ready');
    }
    const tree = createElement(GitHubAuthProvider, null, createElement(PipelineChild));
    const view = render(tree);
    expect(api.onGitHubOAuthCallback).not.toHaveBeenCalled();
    expect(secureStorageLoad).not.toHaveBeenCalled();

    vi.mocked(usePreviewFeatures).mockReturnValue({ githubPipelines: true });
    view.rerender(createElement(GitHubAuthProvider, null, createElement(PipelineChild)));
    await view.findByText('Ready');
    expect(mounted).toHaveBeenCalledOnce();
    expect(secureStorageLoad).toHaveBeenCalledOnce();
    expect(api.onGitHubOAuthCallback).toHaveBeenCalledOnce();
    expect(api.startGitHubOAuth).not.toHaveBeenCalled();

    vi.mocked(usePreviewFeatures).mockReturnValue({ githubPipelines: false });
    view.rerender(createElement(GitHubAuthProvider, null, createElement(PipelineChild)));
    expect(view.queryByText('Ready')).toBeNull();
    expect(unmounted).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(secureStorageLoad).toHaveBeenCalledOnce();

    vi.mocked(usePreviewFeatures).mockReturnValue({ githubPipelines: true });
    view.rerender(createElement(GitHubAuthProvider, null, createElement(PipelineChild)));
    await view.findByText('Ready');
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(api.onGitHubOAuthCallback).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
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
