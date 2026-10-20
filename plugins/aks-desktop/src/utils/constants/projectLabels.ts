// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Kubernetes label key: the project identifier (namespace name). */
export const PROJECT_ID_LABEL = 'headlamp.dev/project-id';

/** Kubernetes label key: which tool manages this project. */
export const PROJECT_MANAGED_BY_LABEL = 'headlamp.dev/project-managed-by';

/** The value for the managed-by label set by AKS Desktop. */
export const PROJECT_MANAGED_BY_VALUE = 'aks-desktop';

/** Kubernetes label key: the Azure subscription associated with the project. */
export const SUBSCRIPTION_LABEL = 'aks-desktop/project-subscription';

/** Kubernetes label key: the Azure resource group associated with the project. */
export const RESOURCE_GROUP_LABEL = 'aks-desktop/project-resource-group';

/** Kubernetes label key: whether the namespace is managed by ARM. */
export const MANAGED_BY_ARM_LABEL = 'kubernetes.azure.com/managedByArm';

/**
 * Kubernetes label key: which authorization model grants access to this project.
 *
 * Only set on Arc (AKS Hybrid & Edge) projects, where the model is a property of
 * the cluster rather than something derivable from the namespace. Managed AKS
 * needs no equivalent — AKS stamps {@link MANAGED_BY_ARM_LABEL} itself.
 */
export const AUTHZ_MODEL_LABEL = 'aks-desktop/project-authz-model';

/** Access is granted by Azure role assignments, enforced by the `guard` webhook. */
export const AUTHZ_MODEL_AZURE_RBAC = 'azure-rbac';

/** Access is granted by Kubernetes RoleBindings in the namespace. */
export const AUTHZ_MODEL_KUBERNETES_RBAC = 'kubernetes-rbac';
