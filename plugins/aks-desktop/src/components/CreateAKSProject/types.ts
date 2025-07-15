// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Types for CreateAKSProject component and its sub-components

export interface AzureSubscription {
  id: string;
  name: string;
  tenant: string;
  tenantName: string;
  status: string;
}

export interface AzureCluster {
  name: string;
  location: string;
  version: string;
  nodeCount: number;
  status: string;
  resourceGroup: string;
  powerState?: string;
}

export interface UserAssignment {
  email: string;
  role: string;
}

export interface FormData {
  // Basics
  projectName: string;
  description: string;
  subscription: string;
  cluster: string;
  resourceGroup: string;

  // Networking Policies
  ingress: 'AllowSameNamespace' | 'AllowAll' | 'DenyAll';
  egress: 'AllowSameNamespace' | 'AllowAll' | 'DenyAll';

  // Compute Quota
  cpuRequest: number;
  memoryRequest: number;
  cpuLimit: number;
  memoryLimit: number;

  // Access
  userAssignments: UserAssignment[];
}

export interface ValidationState {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fieldErrors?: Record<string, string[]>;
}

export interface StepValidation {
  basics: ValidationState;
  networking: ValidationState;
  compute: ValidationState;
  access: ValidationState;
  review: ValidationState;
}

export interface ExtensionStatus {
  installed: boolean | null;
  installing: boolean;
  error: string | null;
  showSuccess: boolean;
}

export interface FeatureStatus {
  registered: boolean | null;
  state: string | null;
  registering: boolean;
  error: string | null;
  showSuccess: boolean;
}

export interface NamespaceStatus {
  exists: boolean | null;
  checking: boolean;
  error: string | null;
}

export interface AzureResourceState {
  subscriptions: AzureSubscription[];
  clusters: AzureCluster[];
  loading: boolean;
  loadingClusters: boolean;
  error: string | null;
  clusterError: string | null;
}

export interface CreationState {
  isCreating: boolean;
  progress: string;
  error: string | null;
  showSuccessDialog: boolean;
  applicationName: string;
}

export interface StepProps {
  formData: FormData;
  onFormDataChange: (updates: Partial<FormData>) => void;
  validation: ValidationState;
  loading?: boolean;
  error?: string | null;
}

export interface BasicsStepProps extends StepProps {
  subscriptions: AzureSubscription[];
  clusters: AzureCluster[];
  loadingClusters: boolean;
  clusterError: string | null;
  extensionStatus: ExtensionStatus;
  featureStatus: FeatureStatus;
  namespaceStatus: NamespaceStatus;
  onInstallExtension: () => Promise<void>;
  onRegisterFeature: () => Promise<void>;
  onRetrySubscriptions: () => Promise<void>;
  onRetryClusters: () => Promise<void>;
}

export interface NetworkingStepProps extends StepProps {
  // No additional props needed for networking step
}

export interface ComputeStepProps extends StepProps {
  // No additional props needed for compute step
}

export interface AccessStepProps extends StepProps {
  // No additional props needed for access step
}

export interface ReviewStepProps extends StepProps {
  subscriptions: AzureSubscription[];
  clusters: AzureCluster[];
}

export interface BreadcrumbProps {
  steps: string[];
  activeStep: number;
  onStepClick: (step: number) => void;
}

export interface FormFieldProps {
  label: string;
  value: string | number;
  onChange: (value: string | number) => void;
  type?: 'text' | 'email' | 'number' | 'textarea';
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
}

export interface ValidationAlertProps {
  type: 'error' | 'warning' | 'success' | 'info';
  message: string | React.ReactNode;
  onClose?: () => void;
  action?: React.ReactNode;
  show?: boolean;
}

export interface ResourceCardProps {
  title: string;
  icon: string;
  iconColor: string;
  children: React.ReactNode;
}

export interface AssignmentRowProps {
  assignment: UserAssignment;
  index: number;
  onUpdate: (index: number, updates: Partial<UserAssignment>) => void;
  onRemove: (index: number) => void;
  validation: ValidationState;
}

// Validation result types
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
  fieldErrors?: Record<string, string[]>;
}

export interface EmailValidationResult extends ValidationResult {
  isValidEmail: boolean;
}

export interface FormValidationResult extends ValidationResult {
  fieldErrors: Record<string, string[]>;
}

// Azure API response types
export interface AzureApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface NamespaceCheckResult {
  exists: boolean;
  error?: string;
}

export interface ExtensionCheckResult {
  installed: boolean;
  error?: string;
}

export interface FeatureCheckResult {
  registered: boolean;
  state?: string;
  error?: string;
}

// Step names as constants
export const STEPS = [
  'Basics',
  'Networking Policies',
  'Compute Quota',
  'Access',
  'Review',
] as const;

export type StepName = (typeof STEPS)[number];

// Default form data
export const DEFAULT_FORM_DATA: FormData = {
  projectName: 'new-aks-project',
  description: '',
  subscription: '',
  cluster: '',
  resourceGroup: '',
  ingress: 'AllowSameNamespace',
  egress: 'AllowAll',
  cpuRequest: 2000,
  memoryRequest: 4096,
  cpuLimit: 2000,
  memoryLimit: 4096,
  userAssignments: [{ email: '', role: 'Writer' }],
};

// Available roles
export const AVAILABLE_ROLES = ['Admin', 'Writer', 'Reader'] as const;

export type RoleType = (typeof AVAILABLE_ROLES)[number];

// Role descriptions
export const ROLE_DESCRIPTIONS: Record<RoleType, string> = {
  Reader:
    'Read-only access to most objects in a namespace. Cannot view roles, role bindings, or Secrets.',
  Writer:
    'Read/write access to most objects in a namespace. Cannot view or modify roles or role bindings. Can access Secrets and run Pods as any ServiceAccount in the namespace.',
  Admin:
    'Read/write access to most resources in a namespace. Can create roles and role bindings within the namespace. Cannot write to resource quota or the namespace itself.',
};

// Map UI role names to Azure RBAC role names
export function mapUIRoleToAzureRole(uiRole: string): string {
  const roleMap: Record<string, string> = {
    Admin: 'Azure Kubernetes Service RBAC Admin',
    Writer: 'Azure Kubernetes Service RBAC Writer',
    Reader: 'Azure Kubernetes Service RBAC Reader',
  };

  return roleMap[uiRole] || uiRole; // Fallback to original if not found
}

// Networking policy options
export const INGRESS_OPTIONS = [
  { value: 'AllowSameNamespace', label: 'Allow traffic within same namespace' },
  { value: 'AllowAll', label: 'Allow all traffic' },
  { value: 'DenyAll', label: 'Deny all traffic' },
] as const;

export const EGRESS_OPTIONS = [
  { value: 'AllowAll', label: 'Allow all traffic' },
  { value: 'AllowSameNamespace', label: 'Allow traffic within same namespace' },
  { value: 'DenyAll', label: 'Deny all traffic' },
] as const;
