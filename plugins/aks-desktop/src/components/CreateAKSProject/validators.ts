// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Pure validation functions for CreateAKSProject component
// These functions are easily testable and don't depend on React

import {
  EmailValidationResult,
  FormData,
  FormValidationResult,
  UserAssignment,
  ValidationResult,
} from './types';

/**
 * Validates email format using a comprehensive regex
 */
export const isValidEmail = (email: string): boolean => {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

/**
 * Validates email and returns detailed result
 */
export const validateEmail = (email: string): EmailValidationResult => {
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    return {
      isValid: true, // Empty email is valid (optional field)
      isValidEmail: true,
      errors: [],
    };
  }

  const isValidEmailFormat = isValidEmail(trimmedEmail);

  return {
    isValid: isValidEmailFormat,
    isValidEmail: isValidEmailFormat,
    errors: isValidEmailFormat ? [] : ['Please enter a valid email address'],
  };
};

/**
 * Validates project name
 */
export const validateProjectName = (projectName: string): ValidationResult => {
  const trimmed = projectName.trim();
  const errors: string[] = [];

  // Check if the input has leading or trailing whitespace
  if (projectName !== trimmed && projectName.length > 0) {
    errors.push('Project name cannot have leading or trailing spaces');
  }

  if (!trimmed) {
    errors.push('Project name is required');
  } else if (trimmed.length < 3) {
    errors.push('Project name must be at least 3 characters long');
  } else if (trimmed.length > 63) {
    errors.push('Project name must be less than 63 characters');
  } else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
    errors.push(
      'Project name must contain only lowercase letters, numbers, and hyphens (no spaces). Must start and end with a letter or number.'
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validates user assignments
 */
export const validateAssignments = (assignments: UserAssignment[]): ValidationResult => {
  const errors: string[] = [];

  if (!Array.isArray(assignments)) {
    errors.push('Assignments must be an array');
    return { isValid: false, errors };
  }

  // Check if assignments array is empty (length 0) - this is valid
  if (assignments.length === 0) {
    return { isValid: true, errors: [] };
  }

  // If there are assignments, ALL of them must have valid, non-empty email addresses
  assignments.forEach((assignment, index) => {
    const trimmedEmail = assignment.email.trim();
    if (trimmedEmail === '') {
      errors.push(`Assignee ${index + 1}: Please enter a valid email address or remove this entry`);
    } else if (!isValidEmail(trimmedEmail)) {
      errors.push(`Assignee ${index + 1}: Please enter a valid email address`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validates compute quota values
 */
export const validateComputeQuota = (
  formData: Pick<FormData, 'cpuRequest' | 'cpuLimit' | 'memoryRequest' | 'memoryLimit'>
): ValidationResult => {
  const errors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  // CPU validation
  if (formData.cpuRequest < 0) {
    const error = 'CPU requests cannot be negative';
    errors.push(error);
    fieldErrors.cpuRequest = [error];
  }
  if (formData.cpuLimit < 0) {
    const error = 'CPU limits cannot be negative';
    errors.push(error);
    fieldErrors.cpuLimit = [error];
  }
  if (formData.cpuRequest > formData.cpuLimit) {
    const error = 'CPU requests cannot be greater than CPU limits';
    errors.push(error);
    fieldErrors.cpuRequest = [...(fieldErrors.cpuRequest || []), error];
  }

  // Memory validation
  if (formData.memoryRequest < 0) {
    const error = 'Memory requests cannot be negative';
    errors.push(error);
    fieldErrors.memoryRequest = [error];
  }
  if (formData.memoryLimit < 0) {
    const error = 'Memory limits cannot be negative';
    errors.push(error);
    fieldErrors.memoryLimit = [error];
  }
  if (formData.memoryRequest > formData.memoryLimit) {
    const error = 'Memory requests cannot be greater than memory limits';
    errors.push(error);
    fieldErrors.memoryRequest = [...(fieldErrors.memoryRequest || []), error];
  }

  return {
    isValid: errors.length === 0,
    errors,
    fieldErrors,
  };
};

/**
 * Validates networking policies
 */
export const validateNetworkingPolicies = (
  formData: Pick<FormData, 'ingress' | 'egress'>
): ValidationResult => {
  const errors: string[] = [];
  const validIngress = ['AllowSameNamespace', 'AllowAll', 'DenyAll'];
  const validEgress = ['AllowSameNamespace', 'AllowAll', 'DenyAll'];

  if (!validIngress.includes(formData.ingress)) {
    errors.push('Invalid ingress policy selected');
  }

  if (!validEgress.includes(formData.egress)) {
    errors.push('Invalid egress policy selected');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validates the basics step
 */
export const validateBasicsStep = (
  formData: Pick<FormData, 'projectName' | 'subscription' | 'cluster' | 'resourceGroup'>,
  extensionInstalled: boolean | null,
  featureRegistered: boolean | null,
  namespaceExists: boolean | null,
  checkingNamespace: boolean,
  namespaceError: string | null,
  isClusterMissing?: boolean
): ValidationResult => {
  const errors: string[] = [];

  if (isClusterMissing) {
    errors.push('Selected cluster is not registered');
  }

  // Check extension installation
  if (extensionInstalled !== true) {
    errors.push('AKS Preview Extension must be installed');
  }

  // Check feature registration
  if (featureRegistered !== true) {
    errors.push('ManagedNamespacePreview feature must be registered');
  }

  // Validate project name
  const projectNameValidation = validateProjectName(formData.projectName);
  if (!projectNameValidation.isValid) {
    errors.push(...projectNameValidation.errors);
  }

  // Check required fields
  if (!formData.subscription) {
    errors.push('Subscription must be selected');
  }

  if (!formData.cluster.trim()) {
    errors.push('Cluster must be selected');
  }

  if (!formData.resourceGroup) {
    errors.push('Resource group must be specified');
  }

  // Check namespace existence
  if (checkingNamespace) {
    errors.push('Checking if namespace already exists...');
  } else if (namespaceExists === true) {
    errors.push(
      'Another project already exists with the same name. Please choose a different name.'
    );
  } else if (namespaceError) {
    errors.push(`Namespace check failed: ${namespaceError}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validates the access step
 */
export const validateAccessStep = (assignments: UserAssignment[]): ValidationResult => {
  return validateAssignments(assignments);
};

/**
 * Validates the entire form
 */
export const validateForm = (formData: FormData): FormValidationResult => {
  const fieldErrors: Record<string, string[]> = {};
  const allErrors: string[] = [];

  // Validate project name
  const projectNameValidation = validateProjectName(formData.projectName);
  if (!projectNameValidation.isValid) {
    fieldErrors.projectName = projectNameValidation.errors;
    allErrors.push(...projectNameValidation.errors);
  }

  // Validate assignments
  const assignmentsValidation = validateAssignments(formData.userAssignments);
  if (!assignmentsValidation.isValid) {
    fieldErrors.assignments = assignmentsValidation.errors;
    allErrors.push(...assignmentsValidation.errors);
  }

  // Validate compute quota
  const computeValidation = validateComputeQuota({
    cpuRequest: formData.cpuRequest,
    cpuLimit: formData.cpuLimit,
    memoryRequest: formData.memoryRequest,
    memoryLimit: formData.memoryLimit,
  });
  if (!computeValidation.isValid) {
    fieldErrors.compute = computeValidation.errors;
    allErrors.push(...computeValidation.errors);

    // Add field-specific errors
    if (computeValidation.fieldErrors) {
      Object.assign(fieldErrors, computeValidation.fieldErrors);
    }
  }

  // Validate networking policies
  const networkingValidation = validateNetworkingPolicies({
    ingress: formData.ingress,
    egress: formData.egress,
  });
  if (!networkingValidation.isValid) {
    fieldErrors.networking = networkingValidation.errors;
    allErrors.push(...networkingValidation.errors);
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    fieldErrors,
  };
};

/**
 * Validates a specific step
 */
export const validateStep = (
  step: number,
  formData: FormData,
  extensionInstalled?: boolean | null,
  featureRegistered?: boolean | null,
  namespaceExists?: boolean | null,
  checkingNamespace?: boolean,
  namespaceError?: string | null,
  isClusterMissing?: boolean
): ValidationResult => {
  switch (step) {
    case 0: // Basics
      return validateBasicsStep(
        formData,
        extensionInstalled ?? null,
        featureRegistered ?? null,
        namespaceExists ?? null,
        checkingNamespace ?? false,
        namespaceError ?? null,
        isClusterMissing
      );
    case 1: // Networking
      return validateNetworkingPolicies({
        ingress: formData.ingress,
        egress: formData.egress,
      });
    case 2: // Compute
      return validateComputeQuota({
        cpuRequest: formData.cpuRequest,
        cpuLimit: formData.cpuLimit,
        memoryRequest: formData.memoryRequest,
        memoryLimit: formData.memoryLimit,
      });
    case 3: // Access
      return validateAccessStep(formData.userAssignments);
    case 4: // Review
      return { isValid: true, errors: [] }; // Review step is always valid
    default:
      return { isValid: false, errors: ['Invalid step number'] };
  }
};

/**
 * Sanitizes project name to be Kubernetes namespace compatible
 */
export const sanitizeProjectName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 63);
};

/**
 * Formats CPU value for display
 */
export const formatCpuValue = (value: number): string => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} CPU`;
  }
  return `${value} mCPU`;
};

/**
 * Formats memory value for display
 */
export const formatMemoryValue = (value: number): string => {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} GiB`;
  }
  return `${value} MiB`;
};

/**
 * Validates if a string is a valid Kubernetes resource name
 */
export const isValidKubernetesName = (name: string): boolean => {
  if (!name || typeof name !== 'string') {
    return false;
  }

  const trimmed = name.trim();

  // Check if the input has leading or trailing whitespace
  if (name !== trimmed) {
    return false;
  }

  // Must be 1-63 characters
  if (trimmed.length < 1 || trimmed.length > 63) {
    return false;
  }

  // Must start and end with alphanumeric character
  if (!/^[a-z0-9]/.test(trimmed) || !/[a-z0-9]$/.test(trimmed)) {
    return false;
  }

  // Can contain lowercase letters, numbers, and hyphens
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
    return false;
  }

  return true;
};
