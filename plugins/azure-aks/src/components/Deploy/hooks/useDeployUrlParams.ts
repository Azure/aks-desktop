// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

/**
 * Return type for the {@link useDeployUrlParams} hook.
 */
interface UseDeployUrlParamsResult {
  /** Whether the URL contains `openDeploy=true`, indicating the dialog should open. */
  shouldOpenDialog: boolean;
  /** The value of the `applicationName` query parameter, if present. */
  initialApplicationName: string | undefined;
  /** Resets the trigger state after the dialog has been opened. */
  clearUrlTrigger: () => void;
}

/**
 * Reads and manages URL query parameters for deep-linking into the deploy wizard.
 *
 * Monitors the URL for `openDeploy=true` and an optional `applicationName` parameter.
 * When detected, sets state to trigger dialog opening and automatically removes the
 * parameters from the URL to prevent re-triggering on navigation.
 *
 * @returns An object containing the trigger state and a function to clear it.
 */
export const useDeployUrlParams = (): UseDeployUrlParamsResult => {
  const location = useLocation();
  const history = useHistory();
  const [shouldOpenDialog, setShouldOpenDialog] = useState(false);
  const [initialApplicationName, setInitialApplicationName] = useState<string | undefined>(
    undefined
  );

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const openDeploy = searchParams.get('openDeploy');
    const applicationName = searchParams.get('applicationName');

    if (openDeploy === 'true') {
      setShouldOpenDialog(true);
      setInitialApplicationName(applicationName ?? undefined);

      // Clean up URL parameters using React Router
      searchParams.delete('openDeploy');
      searchParams.delete('applicationName');
      const newSearch = searchParams.toString();
      const newPath = newSearch ? `${location.pathname}?${newSearch}` : location.pathname;
      history.replace(newPath);
    }
  }, [location.search, location.pathname, history]);

  const clearUrlTrigger = useCallback(() => {
    setShouldOpenDialog(false);
    setInitialApplicationName(undefined);
  }, []);

  return {
    shouldOpenDialog,
    initialApplicationName,
    clearUrlTrigger,
  };
};
