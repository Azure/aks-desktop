// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createOctokitClient, getCurrentUser } from '../../../utils/github/github-api';
import {
  clearTokens,
  isTokenExpired,
  loadTokens,
  onOAuthCallback,
  refreshAccessToken,
  saveTokens,
  startBrowserOAuth,
  TokenResponse,
} from '../../../utils/github/github-auth';
import { GitHubAuthState } from '../types';

const INITIAL_AUTH_STATE: GitHubAuthState = {
  isAuthenticated: false,
  isRestoring: true,
  isAuthorizingBrowser: false,
  token: null,
  refreshToken: null,
  expiresAt: null,
  username: null,
  error: null,
};

export interface UseGitHubAuthResult {
  authState: GitHubAuthState;
  octokit: Octokit | null;
  startOAuth: () => Promise<void>;
  reset: () => Promise<void>;
}

/**
 * Manages GitHub OAuth browser flow authorization, token storage/refresh,
 * and Octokit client derivation.
 */
export const useGitHubAuth = (): UseGitHubAuthResult => {
  const [authState, setAuthState] = useState<GitHubAuthState>(INITIAL_AUTH_STATE);
  const isAuthorizingRef = useRef(false);

  // Ref tracking the current token for cross-tree sync comparison.
  const authTokenRef = useRef<string | null>(null);
  useEffect(() => {
    authTokenRef.current = authState.token;
  }, [authState.token]);

  // Mutex for token refresh: ensures only one refresh request is in-flight at a time.
  // Concurrent callers share the same promise to avoid consuming single-use refresh tokens twice.
  const refreshInFlightRef = useRef<Promise<TokenResponse> | null>(null);

  const deduplicatedRefresh = useCallback((refreshToken: string): Promise<TokenResponse> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    const promise = refreshAccessToken(refreshToken).finally(() => {
      refreshInFlightRef.current = null;
    });
    refreshInFlightRef.current = promise;
    return promise;
  }, []);

  // Derive Octokit from token — not stored in useState (Octokit is not React state)
  const octokit = useMemo(
    () => (authState.token ? createOctokitClient(authState.token) : null),
    [authState.token]
  );

  useEffect(() => {
    const restoreSession = async () => {
      const stored = await loadTokens();
      if (!stored) {
        setAuthState(prev => ({ ...prev, isRestoring: false }));
        return;
      }

      let { accessToken, refreshToken: storedRefreshToken, expiresAt } = stored;

      if (isTokenExpired(expiresAt)) {
        try {
          const refreshed = await deduplicatedRefresh(storedRefreshToken);
          accessToken = refreshed.accessToken;
          storedRefreshToken = refreshed.refreshToken;
          expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
          await saveTokens({
            accessToken,
            refreshToken: storedRefreshToken,
            expiresAt,
          });
        } catch (error) {
          console.error('Failed to refresh GitHub token:', error);
          await clearTokens();
          setAuthState(prev => ({ ...prev, isRestoring: false }));
          return;
        }
      }

      try {
        const client = createOctokitClient(accessToken);
        const user = await getCurrentUser(client);
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: true,
          isRestoring: false,
          token: accessToken,
          refreshToken: storedRefreshToken,
          expiresAt,
          username: user.login,
        }));
      } catch (error) {
        console.error('Failed to restore GitHub session:', error);
        await clearTokens();
        setAuthState(prev => ({ ...prev, isRestoring: false }));
      }
    };

    restoreSession();
  }, [deduplicatedRefresh]);

  // Listen for OAuth callback from the Electron main process
  useEffect(() => {
    const unsubscribe = onOAuthCallback(async result => {
      isAuthorizingRef.current = false;

      if (!result.success || !result.accessToken || !result.refreshToken || !result.expiresAt) {
        setAuthState(prev => ({
          ...prev,
          isAuthorizingBrowser: false,
          error: result.error ?? 'Authorization failed',
        }));
        return;
      }

      const { accessToken, refreshToken, expiresAt } = result;
      await saveTokens({ accessToken, refreshToken, expiresAt });

      try {
        const client = createOctokitClient(accessToken);
        const user = await getCurrentUser(client);
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: true,
          isAuthorizingBrowser: false,
          token: accessToken,
          refreshToken,
          expiresAt,
          username: user.login,
          error: null,
        }));
        window.dispatchEvent(new Event('github-auth-update'));
      } catch (userErr) {
        await clearTokens();
        console.error('OAuth callback: failed to fetch current user:', userErr);
        setAuthState(prev => ({
          ...prev,
          isAuthorizingBrowser: false,
          error: userErr instanceof Error ? userErr.message : 'Failed to verify GitHub user',
        }));
      }
    });

    return unsubscribe;
  }, []);

  // Proactive token refresh: check every 5 minutes whether the token needs refreshing.
  // Uses refs to avoid recreating the interval on every state change.
  const refreshTokenRef = useRef(authState.refreshToken);
  const expiresAtRef = useRef(authState.expiresAt);
  useEffect(() => {
    refreshTokenRef.current = authState.refreshToken;
    expiresAtRef.current = authState.expiresAt;
  }, [authState.refreshToken, authState.expiresAt]);

  useEffect(() => {
    if (!authState.isAuthenticated) return;

    const REFRESH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
    const intervalId = setInterval(async () => {
      const currentExpiresAt = expiresAtRef.current;
      const currentRefreshToken = refreshTokenRef.current;
      if (!currentExpiresAt || !currentRefreshToken) return;
      if (!isTokenExpired(currentExpiresAt)) return;

      try {
        const refreshed = await deduplicatedRefresh(currentRefreshToken);
        const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
        await saveTokens({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: newExpiresAt,
        });
        setAuthState(prev => ({
          ...prev,
          token: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: newExpiresAt,
        }));
        window.dispatchEvent(new Event('github-auth-update'));
      } catch (error) {
        console.error('Proactive token refresh failed:', error);
        await clearTokens();
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: false,
          token: null,
          refreshToken: null,
          expiresAt: null,
          error: 'Session expired. Please re-authenticate.',
        }));
        window.dispatchEvent(new Event('github-auth-update'));
      }
    }, REFRESH_CHECK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [authState.isAuthenticated, deduplicatedRefresh]);

  // Cross-tree auth sync: each GitHubAuthProvider lives in an independent React tree
  // (Headlamp mounts each registered component separately). When one tree completes
  // auth or signs out, it dispatches 'github-auth-update'. Other trees pick up
  // the change from secure storage here.
  useEffect(() => {
    const handleAuthUpdate = async () => {
      if (isAuthorizingRef.current) return;

      const stored = await loadTokens();
      if (!stored) {
        // Tokens cleared by another tree — sign out
        setAuthState(prev =>
          prev.isAuthenticated ? { ...INITIAL_AUTH_STATE, isRestoring: false } : prev
        );
        return;
      }

      // Already have this token
      if (stored.accessToken === authTokenRef.current) return;
      if (isTokenExpired(stored.expiresAt)) return;

      try {
        const client = createOctokitClient(stored.accessToken);
        const user = await getCurrentUser(client);
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: true,
          isRestoring: false,
          isAuthorizingBrowser: false,
          token: stored.accessToken,
          refreshToken: stored.refreshToken,
          expiresAt: stored.expiresAt,
          username: user.login,
          error: null,
        }));
      } catch {
        // Token invalid — ignore
      }
    };

    window.addEventListener('github-auth-update', handleAuthUpdate);
    return () => window.removeEventListener('github-auth-update', handleAuthUpdate);
  }, []);

  const startOAuth = useCallback(async () => {
    if (isAuthorizingRef.current) return;
    isAuthorizingRef.current = true;
    try {
      setAuthState(prev => ({
        ...prev,
        isAuthorizingBrowser: true,
        error: null,
      }));
      await startBrowserOAuth();
    } catch (error) {
      isAuthorizingRef.current = false;
      console.error('Failed to start browser OAuth:', error);
      setAuthState(prev => ({
        ...prev,
        isAuthorizingBrowser: false,
        error: error instanceof Error ? error.message : 'Failed to start authorization',
      }));
    }
  }, []);

  const reset = useCallback(async () => {
    isAuthorizingRef.current = false;
    await clearTokens();
    setAuthState({ ...INITIAL_AUTH_STATE, isRestoring: false });
    window.dispatchEvent(new Event('github-auth-update'));
  }, []);

  return { authState, octokit, startOAuth, reset };
};
