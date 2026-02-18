// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createOctokitClient, getCurrentUser } from '../../../utils/github/github-api';
import {
  clearTokens,
  initiateDeviceFlow,
  isTokenExpired,
  loadTokens,
  refreshAccessToken,
  requestAccessToken,
  saveTokens,
} from '../../../utils/github/github-auth';
import { GitHubAuthState } from '../types';

const INITIAL_AUTH_STATE: GitHubAuthState = {
  isAuthenticated: false,
  isRestoring: true,
  isAuthorizingDevice: false,
  token: null,
  refreshToken: null,
  expiresAt: null,
  userCode: null,
  verificationUri: null,
  username: null,
  error: null,
};

/**
 * Return type for the {@link useGitHubAuth} hook.
 */
interface UseGitHubAuthResult {
  /** Current GitHub device flow auth state. */
  authState: GitHubAuthState;
  /** The Octokit client, available when authenticated with a valid token. Derived via useMemo from authState.token. */
  octokit: Octokit | null;
  /** Initiates the device flow: gets a user code, opens verification URL, polls for authorization. */
  startDeviceFlow: () => void;
  /** Resets the auth state and clears stored tokens. */
  reset: () => void;
}

/**
 * Manages GitHub OAuth device flow authorization, token storage/refresh,
 * and Octokit client derivation.
 */
export const useGitHubAuth = (): UseGitHubAuthResult => {
  const [authState, setAuthState] = useState<GitHubAuthState>(INITIAL_AUTH_STATE);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive Octokit from token — not stored in useState (Octokit is not React state)
  const octokit = useMemo(
    () => (authState.token ? createOctokitClient(authState.token) : null),
    [authState.token]
  );

  // On mount: restore tokens from localStorage
  useEffect(() => {
    const restoreSession = async () => {
      const stored = await loadTokens();
      if (!stored) {
        setAuthState(prev => ({ ...prev, isRestoring: false }));
        return;
      }

      let { accessToken, refreshToken: storedRefreshToken, expiresAt } = stored;

      // If expired, try to refresh
      if (isTokenExpired(expiresAt)) {
        try {
          const refreshed = await refreshAccessToken(storedRefreshToken);
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

      // Fetch username with the valid token
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
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
      }
    };
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
        const refreshed = await refreshAccessToken(currentRefreshToken);
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
      }
    }, REFRESH_CHECK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [authState.isAuthenticated]);

  const startDeviceFlow = useCallback(async () => {
    if (authState.isAuthorizingDevice) return;
    try {
      const flow = await initiateDeviceFlow();

      setAuthState(prev => ({
        ...prev,
        isAuthorizingDevice: true,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        error: null,
      }));

      window.open(flow.verificationUri, '_blank');

      let pollCount = 0;
      const maxPolls = Math.ceil(flow.expiresIn / flow.interval);
      let currentInterval = flow.interval;

      const poll = () => {
        pollRef.current = setTimeout(async () => {
          pollCount++;
          try {
            const tokens = await requestAccessToken(flow.deviceCode);
            pollRef.current = null;

            const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
            await saveTokens({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt,
            });

            const client = createOctokitClient(tokens.accessToken);
            const user = await getCurrentUser(client);

            setAuthState(prev => ({
              ...prev,
              isAuthenticated: true,
              isAuthorizingDevice: false,
              token: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt,
              username: user.login,
              userCode: null,
              verificationUri: null,
            }));
          } catch (error) {
            if (error instanceof Error && error.message === 'slow_down') {
              currentInterval += 5;
              poll();
              return;
            }
            if (error instanceof Error && error.message === 'authorization_pending') {
              if (pollCount >= maxPolls) {
                pollRef.current = null;
                setAuthState(prev => ({
                  ...prev,
                  isAuthorizingDevice: false,
                  error: 'Authorization timed out. Please try again.',
                  userCode: null,
                  verificationUri: null,
                }));
                return;
              }
              poll();
              return;
            }
            // Fatal error (expired_token, access_denied, or network error)
            pollRef.current = null;
            console.error('Device flow authorization failed:', error);
            setAuthState(prev => ({
              ...prev,
              isAuthorizingDevice: false,
              error: error instanceof Error ? error.message : 'Authorization failed',
              userCode: null,
              verificationUri: null,
            }));
          }
        }, currentInterval * 1000);
      };

      poll();
    } catch (error) {
      console.error('Failed to initiate device flow:', error);
      setAuthState(prev => ({
        ...prev,
        isAuthorizingDevice: false,
        error: error instanceof Error ? error.message : 'Failed to start authorization',
      }));
    }
  }, [authState.isAuthorizingDevice]);

  const reset = useCallback(async () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    await clearTokens();
    setAuthState({ ...INITIAL_AUTH_STATE, isRestoring: false });
  }, []);

  return { authState, octokit, startDeviceFlow, reset };
};
