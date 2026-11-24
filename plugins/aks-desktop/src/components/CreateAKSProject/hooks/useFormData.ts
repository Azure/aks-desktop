// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useState } from 'react';
import { AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT } from '../../../utils/azure/az-token';
import type { FormData } from '../types';
import { DEFAULT_FORM_DATA } from '../types';

/**
 * Custom hook for managing form data state
 */
export const useFormData = (initialData: Partial<FormData> = {}) => {
  const [formData, setFormData] = useState<FormData>({
    ...DEFAULT_FORM_DATA,
    ...initialData,
  });

  useEffect(() => {
    const handleTenantChange = (event: Event) => {
      if (!(event instanceof CustomEvent) || !Array.isArray(event.detail?.subscriptionIds)) return;
      const changed = new Set<string>(
        event.detail.subscriptionIds
          .filter((id: unknown): id is string => typeof id === 'string')
          .map((id: string) => id.toLowerCase())
      );
      setFormData(current =>
        changed.has(current.subscription.toLowerCase())
          ? { ...current, userAssignments: [] }
          : current
      );
    };
    window.addEventListener(AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT, handleTenantChange);
    return () =>
      window.removeEventListener(AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT, handleTenantChange);
  }, []);

  const updateFormData = useCallback((updates: Partial<FormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  }, []);

  const resetFormData = useCallback(() => {
    setFormData(DEFAULT_FORM_DATA);
  }, []);

  const setFormDataField = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  return {
    formData,
    updateFormData,
    resetFormData,
    setFormDataField,
  };
};
