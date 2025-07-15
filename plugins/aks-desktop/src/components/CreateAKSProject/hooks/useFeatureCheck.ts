// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useState } from 'react';
import {
  isManagedNamespacePreviewRegistered,
  registerContainerServiceProvider,
  registerManagedNamespacePreview,
} from '../../../utils/azure/az-cli';
import { FeatureStatus } from '../types';

/**
 * Custom hook for managing ManagedNamespacePreview feature status
 */
export const useFeatureCheck = ({ subscription }: { subscription?: string }) => {
  const [status, setStatus] = useState<FeatureStatus>({
    registered: null,
    state: null,
    registering: false,
    error: null,
    showSuccess: false,
  });

  const checkFeature = useCallback(async () => {
    if (!subscription) return;
    try {
      const result = await isManagedNamespacePreviewRegistered({ subscription });
      setStatus(prev => ({
        ...prev,
        registered: result.registered,
        state: result.state || null,
        error: result.registered ? null : result.error || null,
      }));
    } catch (error) {
      console.error('Failed to check feature:', error);
      setStatus(prev => ({
        ...prev,
        registered: false,
        state: null,
        error: 'Failed to check feature status',
      }));
    }
  }, [subscription]);

  const registerFeature = useCallback(async () => {
    try {
      setStatus(prev => ({ ...prev, registering: true, error: null }));

      // Step 1: Register the feature
      const featureResult = await registerManagedNamespacePreview();

      if (!featureResult.success) {
        setStatus(prev => ({
          ...prev,
          error: featureResult.error || 'Failed to register feature',
        }));
        return;
      }

      // Step 2: Register the provider to propagate changes
      const providerResult = await registerContainerServiceProvider();

      if (!providerResult.success) {
        setStatus(prev => ({
          ...prev,
          error: providerResult.error || 'Feature registered but failed to register provider',
        }));
        return;
      }

      // Both operations successful
      setStatus(prev => ({
        ...prev,
        registered: true,
        state: 'Registered',
        error: null,
        showSuccess: true,
      }));

      // Hide success message after 3 seconds
      setTimeout(() => {
        setStatus(prev => ({ ...prev, showSuccess: false }));
      }, 3000);
    } catch (error) {
      console.error('Failed to register feature:', error);
      setStatus(prev => ({
        ...prev,
        error: 'Failed to register feature',
      }));
    } finally {
      setStatus(prev => ({ ...prev, registering: false }));
    }
  }, []);

  const clearError = useCallback(() => {
    setStatus(prev => ({ ...prev, error: null }));
  }, []);

  // Check feature on mount
  useEffect(() => {
    checkFeature();
  }, [checkFeature, subscription]);

  return {
    ...status,
    checkFeature,
    registerFeature,
    clearError,
  };
};
