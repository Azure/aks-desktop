// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useState } from 'react';
import {
  installExtension as installAzExtension,
  isExtensionInstalled,
} from '../../../utils/azure/az-extensions';
import type { ExtensionStatus } from '../types';

/**
 * Custom hook for managing an Azure CLI extension's status.
 *
 * @param extensionName - The `az` extension to check/install. Defaults to
 *   `'aks-preview'`; pass `'connectedk8s'` for the AKS Hybrid & Edge proxy path.
 */
export const useExtensionCheck = (extensionName: string = 'aks-preview') => {
  const [status, setStatus] = useState<ExtensionStatus>({
    installed: null,
    installing: false,
    error: null,
    showSuccess: false,
  });

  const checkExtension = useCallback(async () => {
    try {
      const result = await isExtensionInstalled(extensionName);
      setStatus(prev => ({
        ...prev,
        installed: result.installed,
        error: result.installed ? null : result.error || null,
      }));
    } catch (error) {
      console.error('Failed to check extension:', error);
      setStatus(prev => ({
        ...prev,
        installed: false,
        error: 'Failed to check extension status',
      }));
    }
  }, [extensionName]);

  const installExtension = useCallback(async () => {
    try {
      setStatus(prev => ({ ...prev, installing: true, error: null }));
      const result = await installAzExtension(extensionName);

      if (result.success) {
        setStatus(prev => ({
          ...prev,
          installed: true,
          error: null,
          showSuccess: true,
        }));

        // Hide success message after 3 seconds
        setTimeout(() => {
          setStatus(prev => ({ ...prev, showSuccess: false }));
        }, 3000);
      } else {
        setStatus(prev => ({
          ...prev,
          error: result.error || 'Failed to install extension',
        }));
      }
    } catch (error) {
      console.error('Failed to install extension:', error);
      setStatus(prev => ({
        ...prev,
        error: 'Failed to install extension',
      }));
    } finally {
      setStatus(prev => ({ ...prev, installing: false }));
    }
  }, [extensionName]);

  const clearError = useCallback(() => {
    setStatus(prev => ({ ...prev, error: null }));
  }, []);

  // Check extension on mount
  useEffect(() => {
    checkExtension();
  }, [checkExtension]);

  return {
    ...status,
    checkExtension,
    installExtension,
    clearError,
  };
};
