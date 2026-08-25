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
   */
  clusterType?: 'aks' | 'aksarc';
  /**
   * Arc agent heartbeat for AKS Hybrid & Edge clusters (`'Connected'` |
   * `'Offline'` | `'Expired'`…); `undefined` for managed AKS.
   *
   * Needed because `status` (the connected cluster's `provisioningState`) is
   * frozen at `Succeeded` once the ARM deployment finishes and never degrades —
   * so for an Arc cluster it says nothing about whether the cluster is up. This
   * is what tells the dropdown an Arc cluster is offline, matching the Add
   * Cluster dialog.
   *
   * It is a *cached* heartbeat, so it only gates the dropdown. Whether a
   * connected Arc cluster is actually usable is still settled by a live
   * Kubernetes API probe (`checkClusterAccessible`) once it is selected.
   */
  connectivityStatus?: string;
  /**
   * For Arc clusters: `aadProfile.enableAzureRbac`. Selects how project access is
   * granted — `false` (the default) means native Kubernetes RBAC via RoleBindings
   * in the applied manifest, `true` means Azure role assignments at namespace
   * scope. Fixed at cluster creation and not changeable afterwards.
   */
  azureRbacEnabled?: boolean;
}

export interface UserAssignment {
  /**
   * Entra object ID. What Azure role assignments key on
   * (`az role assignment create --assignee-object-id`).
   */
  objectId: string;
  displayName?: string;
  /**
   * Entra user principal name. What a Kubernetes RoleBinding subject must be
   * named on an Arc cluster — `kube-aad-proxy` impersonates the user by UPN, and
   * the object ID reaches the apiserver only as an `Extra: oid` attribute, which
   * RBAC subjects never match. A binding naming the object ID applies cleanly and
   * grants nothing.
   *
   * Populated from directory search; may be absent when a bare object ID was
   * typed by hand and the directory could not be read.
   */
  upn?: string;
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
  /**
   * True when the grant will be a Kubernetes RoleBinding — an Arc cluster using
   * native RBAC. Its subject must be the user's UPN, so an assignee known only by
   * object ID has to be rejected here. False for managed AKS and for Arc clusters
   * authorizing through Azure RBAC, which key on the object ID instead.
   */
  requiresUpn?: boolean;
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
