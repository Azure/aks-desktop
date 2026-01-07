// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

interface UseDeployUrlParamsResult {
  shouldOpenDialog: boolean;
  initialApplicationName: string | undefined;
  clearUrlTrigger: () => void;
}

/**
 * Custom hook to handle URL parameters for deploying applications
 * Checks for 'openDeploy' and 'applicationName' query parameters
 * and automatically cleans them up from the URL after reading
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
      if (applicationName) {
        setInitialApplicationName(applicationName);
      }

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
