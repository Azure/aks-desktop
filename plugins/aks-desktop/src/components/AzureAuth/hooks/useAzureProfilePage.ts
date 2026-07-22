// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../../hooks/useAzureAuth';
import { trackError } from '../../../telemetry';
import { trackAksFeature } from '../../../telemetry/aksFeature';
import { PROFILE_REDIRECT_DELAY_MS } from '../../../utils/constants/timing';

function trackLogoutFailure() {
  trackAksFeature('aksd.auth-logout', 'failed');
  try {
    trackError({ area: 'auth-logout', errorClass: 'UnknownError', phase: 'failed' });
  } catch {}
}

/**
 * Return type for {@link useAzureProfilePage}.
 */
export interface UseAzureProfilePageResult {
  /** Whether the auth state is still being determined. */
  isChecking: boolean;
  /** Whether the user is currently logged in to Azure. */
  isLoggedIn: boolean;
  /** The logged-in user's Azure username, or `undefined` if not available. */
  username: string | undefined;
  /** The active tenant ID, or `undefined` if not available. */
  tenantId: string | undefined;
  /** The default subscription ID, or `undefined` if not available. */
  subscriptionId: string | undefined;
  /** `true` while the logout command is in flight. */
  loggingOut: boolean;
  /** Navigates back to the home page. */
  handleBack: () => void;
  /** Navigates to the Add Cluster from Azure page. */
  handleAddCluster: () => void;
  /**
   * Initiates the Azure CLI logout flow. On success, dispatches an
   * `azure-auth-update` event and redirects to the login page after
   * {@link PROFILE_REDIRECT_DELAY_MS}.
   */
  handleLogout: () => Promise<void>;
}

/**
 * Encapsulates all stateful logic for the Azure Profile page.
 *
 * Responsibilities:
 * - Exposes the current Azure auth state fields needed by the page.
 * - Redirects to `/azure/login` when the user is not logged in.
 * - Provides `handleBack`, `handleAddCluster`, and `handleLogout` callbacks.
 * - Manages the `loggingOut` in-flight state for the logout button.
 */
export function useAzureProfilePage(): UseAzureProfilePageResult {
  const history = useHistory();
  const authStatus = useAzureAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const logoutAttemptGenerationRef = useRef(0);

  const isCurrentLogoutAttempt = (attemptGeneration: number) =>
    mountedRef.current && logoutAttemptGenerationRef.current === attemptGeneration;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      logoutAttemptGenerationRef.current++;
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, []);

  // Redirect to login page when the user is not (or no longer) logged in,
  // except while an explicit logout flow is already handling the redirect.
  useEffect(() => {
    if (!loggingOut && !authStatus.isChecking && !authStatus.isLoggedIn) {
      history.push('/azure/login');
    }
  }, [authStatus.isChecking, authStatus.isLoggedIn, history, loggingOut]);

  const handleBack = () => {
    history.push('/');
  };

  const handleAddCluster = () => {
    history.push('/add-cluster-aks');
  };

  const handleLogout = async () => {
    const attemptGeneration = ++logoutAttemptGenerationRef.current;
    trackAksFeature('aksd.auth-logout', 'started');
    setLoggingOut(true);
    try {
      // Dynamic import avoids circular dependencies at module load time.
      const { runCommandAsync, isAzError } = await import('../../../utils/azure/az-cli-core');
      const result = await runCommandAsync('az', ['logout']);
      if (!isCurrentLogoutAttempt(attemptGeneration)) {
        return;
      }

      if (result.stderr && isAzError(result.stderr)) {
        console.error('Azure CLI logout error:', result.stderr);
        trackLogoutFailure();
        setLoggingOut(false);
        return;
      }

      trackAksFeature('aksd.auth-logout', 'succeeded');

      // Notify the sidebar label to refresh its auth state.
      window.dispatchEvent(new CustomEvent('azure-auth-update'));

      // Stay in loggingOut=true state until the component unmounts on redirect.
      redirectTimerRef.current = setTimeout(() => {
        if (isCurrentLogoutAttempt(attemptGeneration)) {
          history.push('/azure/login');
        }
      }, PROFILE_REDIRECT_DELAY_MS);
    } catch (error) {
      if (!isCurrentLogoutAttempt(attemptGeneration)) {
        return;
      }
      console.error('Error logging out:', error);
      trackLogoutFailure();
      setLoggingOut(false);
    }
  };

  return {
    isChecking: authStatus.isChecking,
    isLoggedIn: authStatus.isLoggedIn,
    username: authStatus.username,
    tenantId: authStatus.tenantId,
    subscriptionId: authStatus.subscriptionId,
    loggingOut,
    handleBack,
    handleAddCluster,
    handleLogout,
  };
}
