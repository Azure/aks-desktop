// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useState } from 'react';
import {
  installAksPreviewExtension,
  isAksPreviewExtensionInstalled,
} from '../../../utils/azure/az-cli';
import { ExtensionStatus } from '../types';

/**
 * Custom hook for managing AKS Preview Extension status
 */
export const useExtensionCheck = () => {
  const [status, setStatus] = useState<ExtensionStatus>({
    installed: null,
    installing: false,
    error: null,
    showSuccess: false,
  });

  const checkExtension = useCallback(async () => {
    try {
      const result = await isAksPreviewExtensionInstalled();
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
  }, []);

  const installExtension = useCallback(async () => {
    try {
      setStatus(prev => ({ ...prev, installing: true, error: null }));
      const result = await installAksPreviewExtension();

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
  }, []);

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
