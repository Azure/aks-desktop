// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';
import { DEFAULT_FORM_DATA, FormData } from '../types';

/**
 * Custom hook for managing form data state
 */
export const useFormData = (initialData: Partial<FormData> = {}) => {
  const [formData, setFormData] = useState<FormData>({
    ...DEFAULT_FORM_DATA,
    ...initialData,
  });

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
