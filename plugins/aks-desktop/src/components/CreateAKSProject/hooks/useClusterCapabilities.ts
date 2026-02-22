// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useRef, useState } from 'react';
import type { ClusterCapabilities } from '../../../types/ClusterCapabilities';
import { getClusterCapabilities } from '../../../utils/azure/az-cli';

interface ClusterCapabilitiesState {
  capabilities: ClusterCapabilities | null;
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook for managing cluster capabilities state
 */
export const useClusterCapabilities = () => {
  const [state, setState] = useState<ClusterCapabilitiesState>({
    capabilities: null,
    loading: false,
    error: null,
  });

  const requestIdRef = useRef(0);

  const fetchCapabilities = useCallback(
    async (subscriptionId: string, resourceGroup: string, clusterName: string) => {
      const requestId = ++requestIdRef.current;
      setState({ capabilities: null, loading: true, error: null });
      try {
        const capabilities = await getClusterCapabilities({
          subscriptionId,
          resourceGroup,
          clusterName,
        });
        if (requestId !== requestIdRef.current) return null;
        setState({ capabilities, loading: false, error: null });
        return capabilities;
      } catch (err) {
        if (requestId !== requestIdRef.current) return null;
        console.error('[Capabilities] Failed to fetch cluster capabilities:', err);
        let errorMessage =
          err instanceof Error ? err.message : 'Failed to check cluster capabilities';

        // Provide more specific error messages
        if (errorMessage.includes('Azure CLI (az) command not found')) {
          errorMessage = 'Azure CLI is not installed. Please install Azure CLI and try again.';
        } else if (errorMessage.includes('Please log in to Azure CLI')) {
          errorMessage = 'Please log in to Azure CLI first. Use "az login" in your terminal.';
        }

        setState({ capabilities: null, loading: false, error: errorMessage });
        return null;
      }
    },
    []
  );

  const clearCapabilities = useCallback(() => {
    ++requestIdRef.current;
    setState({ capabilities: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    fetchCapabilities,
    clearCapabilities,
  };
};
