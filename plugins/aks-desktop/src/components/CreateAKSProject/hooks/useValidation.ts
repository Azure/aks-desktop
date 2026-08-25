// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useMemo } from 'react';
import type { ClusterCapabilities } from '../../../types/ClusterCapabilities';
import type {
  ExtensionStatus,
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
  namespaceStatus?: NamespaceStatus,
  isClusterMissing?: boolean,
  capabilities?: ClusterCapabilities | null,
  isArc?: boolean,
  clusterAccess?: { checking: boolean; accessible: boolean | null },
  /** True when the grant will be a RoleBinding, so every assignee needs a UPN. */
  requiresUpn?: boolean
) => {
  const validation = useMemo((): ValidationState => {
    const result = validateStep(
      activeStep,
      formData,
      extensionStatus?.installed,
      namespaceStatus?.exists,
      namespaceStatus?.checking,
      namespaceStatus?.error || undefined,
      isClusterMissing,
      capabilities,
      isArc,
      clusterAccess?.checking,
      clusterAccess?.accessible,
      requiresUpn
    );
    return {
      ...result,
      warnings: result.warnings,
    };
  }, [
    activeStep,
    formData,
    extensionStatus?.installed,
    namespaceStatus?.exists,
    namespaceStatus?.checking,
    namespaceStatus?.error,
    isClusterMissing,
    capabilities,
    isArc,
    clusterAccess?.checking,
    clusterAccess?.accessible,
    requiresUpn,
  ]);

  const fieldValidation = useMemo((): FormValidationResult => {
    return validateForm(formData, requiresUpn);
  }, [formData, requiresUpn]);

  return {
    ...validation,
    fieldErrors: fieldValidation.fieldErrors,
  };
};
