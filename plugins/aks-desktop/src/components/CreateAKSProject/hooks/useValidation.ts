// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useMemo } from 'react';
import type { ClusterCapabilities } from '../../../types/ClusterCapabilities';
import type {
  ExtensionStatus,
  FeatureStatus,
  FormData,
  FormValidationResult,
  NamespaceStatus,
  ValidationState,
} from '../types';
import { validateForm, validateStep } from '../validators';

/**
 * Custom hook for managing validation state
 */
export const useValidation = (
  activeStep: number,
  formData: FormData,
  extensionStatus?: ExtensionStatus,
  featureStatus?: FeatureStatus,
  namespaceStatus?: NamespaceStatus,
  isClusterMissing?: boolean,
  capabilities?: ClusterCapabilities | null
) => {
  const validation = useMemo((): ValidationState => {
    const result = validateStep(
      activeStep,
      formData,
      extensionStatus?.installed,
      featureStatus?.registered,
      namespaceStatus?.exists,
      namespaceStatus?.checking,
      namespaceStatus?.error || undefined,
      isClusterMissing,
      capabilities
    );
    return {
      ...result,
      warnings: result.warnings,
    };
  }, [
    activeStep,
    formData,
    extensionStatus?.installed,
    featureStatus?.registered,
    namespaceStatus?.exists,
    namespaceStatus?.checking,
    namespaceStatus?.error,
    isClusterMissing,
    capabilities,
  ]);

  const fieldValidation = useMemo((): FormValidationResult => {
    return validateForm(formData);
  }, [formData]);

  return {
    ...validation,
    fieldErrors: fieldValidation.fieldErrors,
  };
};
