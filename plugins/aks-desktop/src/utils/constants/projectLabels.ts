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
