// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Types for CreateAKSProject component and its sub-components

import type { ClusterCapabilities } from '../../types/ClusterCapabilities';

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
  /**
   * `'aks'` for managed clusters, `'aksarc'` for Arc-connected (AKS Hybrid & Edge)
   * clusters. Absence implies a managed AKS cluster. Drives whether the wizard
   * creates a managed namespace (`az aks namespace add`) or applies a native
   * Kubernetes namespace manifest via the Headlamp K8s API.
   *
   * Accessibility of an AKS Hybrid & Edge cluster is NOT inferred from a cached
   * Arc heartbeat — it is verified with a live Kubernetes API probe
   * (`checkClusterAccessible`) at submit time.
   */
  clusterType?: 'aks' | 'aksarc';
}

export interface UserAssignment {
  objectId: string;
  displayName?: string;
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

export interface ExtensionStatus {
  installed: boolean | null;
  installing: boolean;
  error: string | null;
  showSuccess: boolean;
}

export interface NamespaceStatus {
  exists: boolean | null;
  checking: boolean;
  error: string | null;
}

/** Live API reachability state for the selected cluster. */
export interface ClusterAccessStatus {
  /** Whether a reachability probe is currently running. */
  checking: boolean;
  /** Probe result, or `null` when reachability is not applicable or not known. */
  accessible: boolean | null;
}

export interface AzureResourceState {
  subscriptions: AzureSubscription[];
  clusters: AzureCluster[];
  totalClusterCount: number | null;
  loading: boolean;
  loadingClusters: boolean;
  error: string | null;
  clusterError: string | null;
  arcDiscoveryUnavailable: boolean;
}

export interface StepProps {
  formData: FormData;
  onFormDataChange: (updates: Partial<FormData>) => void;
  validation: ValidationState;
  loading?: boolean;
  error?: string | null;
}

export interface BasicsStepProps extends StepProps {
  /** Azure subscriptions available to the signed-in user. */
  subscriptions: AzureSubscription[];
  /** Managed and Arc clusters available for the selected subscription. */
  clusters: AzureCluster[];
  /** Cluster count before unsupported clusters are filtered out. */
  totalClusterCount: number | null;
  /** Whether clusters are being loaded for the selected subscription. */
  loadingClusters: boolean;
  /** Non-fatal cluster discovery error. */
  clusterError: string | null;
  /** Whether Arc discovery is unavailable because `connectedk8s` is missing. */
  arcDiscoveryUnavailable?: boolean;
  /** Installation state for the AKS Preview Azure CLI extension. */
  extensionStatus: ExtensionStatus;
  /** Availability state for the requested project namespace. */
  namespaceStatus: NamespaceStatus;
  /**
   * Live reachability of the selected Arc (AKS Hybrid & Edge) cluster. `accessible`
   * is `null` when not applicable. Used to explain a disabled "Next" button.
   */
  clusterAccessStatus: ClusterAccessStatus;
  /** Capabilities reported by the selected cluster. */
  clusterCapabilities: ClusterCapabilities | null;
  /** Whether selected-cluster capabilities are being loaded. */
  capabilitiesLoading: boolean;
  /** Installs the AKS Preview Azure CLI extension. */
  onInstallExtension: () => Promise<void>;
  /** Retries loading Azure subscriptions. */
  onRetrySubscriptions: () => Promise<void>;
  /** Retries loading clusters for the selected subscription. */
  onRetryClusters: () => Promise<void>;
  /** Refreshes capabilities for the selected cluster. */
  onRefreshCapabilities?: () => void;
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

export interface ValidationAlertProps {
  type: 'error' | 'warning' | 'success' | 'info';
  message: string | React.ReactNode;
  onClose?: () => void;
  action?: React.ReactNode;
  show?: boolean;
}

// Validation result types
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fieldErrors?: Record<string, string[]>;
}

export interface FormValidationResult extends ValidationResult {
  fieldErrors: Record<string, string[]>;
}

// Step names as constants
export const STEPS = [
  'Basics',
  'Networking Policies',
  'Compute Quota',
  'Access',
  'Review',
] as const;

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
  userAssignments: [{ objectId: '', role: 'Writer' }],
};

// Available roles
export const AVAILABLE_ROLES = ['Admin', 'Writer', 'Reader'] as const;

export type RoleType = (typeof AVAILABLE_ROLES)[number];

// Map UI role names to Azure RBAC role names
export function mapUIRoleToAzureRole(uiRole: string): string {
  const roleMap: Record<string, string> = {
    Admin: 'Azure Kubernetes Service RBAC Admin',
    Writer: 'Azure Kubernetes Service RBAC Writer',
    Reader: 'Azure Kubernetes Service RBAC Reader',
  };

  return roleMap[uiRole] || uiRole; // Fallback to original if not found
}
