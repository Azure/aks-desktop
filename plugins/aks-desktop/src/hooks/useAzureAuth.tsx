// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
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

      // Redirect to login if not authenticated and redirectToLogin is true
      if (!status.isLoggedIn && redirectToLogin) {
        // Use location.pathname for the React Router path (not window.location)
        const currentPath = location.pathname + location.search;
        //?redirect=${encodeURIComponent(currentPath)}
        // history.push(`/azure/login`);
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

      if (redirectToLogin) {
        // Use location.pathname for the React Router path (not window.location)
        const currentPath = location.pathname + location.search;
        history.push(`/azure/login?redirect=${encodeURIComponent(currentPath)}`);
      }
    }
  };

  return authStatus;
}

/**
 * Higher-order component to protect routes that require Azure authentication
 */
export function withAzureAuth<P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  return (props: P) => {
    const authStatus = useAzureAuth(true);

    if (authStatus.isChecking) {
      return null; // Or a loading spinner
    }

    if (!authStatus.isLoggedIn) {
      return null; // Will redirect via the hook
    }

    return <Component {...props} />;
  };
}
