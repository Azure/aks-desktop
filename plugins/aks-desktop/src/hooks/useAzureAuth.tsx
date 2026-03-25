// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { getLoginStatus } from '../utils/azure/az-cli';

export interface AzureAuthStatus {
  isLoggedIn: boolean;
  isChecking: boolean;
  username?: string;
  tenantId?: string;
  subscriptionId?: string;
  error?: string;
}

/**
 * Hook to check Azure authentication status
 * @param redirectToLogin - If true, redirects to /azure/login when not authenticated
 * @returns Authentication status
 */
export function useAzureAuth(redirectToLogin = false): AzureAuthStatus {
  const history = useHistory();
  const location = useLocation();
  const [authStatus, setAuthStatus] = useState<AzureAuthStatus>({
    isLoggedIn: false,
    isChecking: true,
  });

  // Use refs so the event listener always reads current values
  const locationRef = useRef(location);
  locationRef.current = location;
  const redirectToLoginRef = useRef(redirectToLogin);
  redirectToLoginRef.current = redirectToLogin;

  const checkAuth = useCallback(async () => {
    try {
      const status = await getLoginStatus();

      const newAuthStatus = {
        isLoggedIn: status.isLoggedIn,
        isChecking: false,
        username: status.username,
        tenantId: status.tenantId,
        subscriptionId: status.subscriptionId,
        error: status.error,
      };

      setAuthStatus(newAuthStatus);

      // Expose auth status to window object for headlamp components
      (window as any).__azureAuthStatus = newAuthStatus;

      if (!status.isLoggedIn && redirectToLoginRef.current) {
        const loc = locationRef.current;
        const currentPath = loc.pathname + loc.search;
        history.push({
          pathname: '/azure/login',
          search: `?redirect=${encodeURIComponent(currentPath)}`,
        });
      }
    } catch (error) {
      console.error('Error checking Azure authentication:', error);
      const errorAuthStatus = {
        isLoggedIn: false,
        isChecking: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      setAuthStatus(errorAuthStatus);

      // Expose auth status to window object for headlamp components
      (window as any).__azureAuthStatus = errorAuthStatus;

      if (redirectToLoginRef.current) {
        const loc = locationRef.current;
        const currentPath = loc.pathname + loc.search;
        history.push(`/azure/login?redirect=${encodeURIComponent(currentPath)}`);
      }
    }
  }, [history]);

  useEffect(() => {
    checkAuth();

    const handleAuthUpdate = () => checkAuth();
    window.addEventListener('azure-auth-update', handleAuthUpdate);
    return () => window.removeEventListener('azure-auth-update', handleAuthUpdate);
  }, [checkAuth]);

  return authStatus;
}
