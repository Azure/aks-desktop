// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../../hooks/useAzureAuth';
import { PROFILE_REDIRECT_DELAY_MS } from '../../../utils/constants/timing';

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

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
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
    setLoggingOut(true);
    try {
      // Dynamic import avoids circular dependencies at module load time.
      const { runCommandAsync, isAzError } = await import('../../../utils/azure/az-cli-core');
      const result = await runCommandAsync('az', ['logout']);

      if (result.stderr && isAzError(result.stderr)) {
        console.error('Azure CLI logout error:', result.stderr);
        setLoggingOut(false);
        return;
      }

      // Notify the sidebar label to refresh its auth state.
      window.dispatchEvent(new CustomEvent('azure-auth-update'));

      // Stay in loggingOut=true state until the component unmounts on redirect.
      redirectTimerRef.current = setTimeout(() => {
        history.push('/azure/login');
      }, PROFILE_REDIRECT_DELAY_MS);
    } catch (error) {
      console.error('Error logging out:', error);
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
