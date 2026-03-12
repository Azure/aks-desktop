// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { RESOURCE_GROUP_LABEL, SUBSCRIPTION_LABEL } from '../../../utils/constants/projectLabels';

/**
 * Extracts AKS Desktop Managed Project labels from the namespace's metadata.
 *
 * @param namespace - Managed Namespace name.
 * @param cluster - Name of target cluster.
 * @returns The subscription and resource group labels written onto the managed namespace during project creation.
 */
export function useNamespaceLabels(namespace: string | undefined, cluster: string | undefined) {
  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster,
  });

  const subscription = namespaceInstance?.jsonData?.metadata?.labels?.[SUBSCRIPTION_LABEL];
  const resourceGroupLabel = namespaceInstance?.jsonData?.metadata?.labels?.[RESOURCE_GROUP_LABEL];

  return { subscription, resourceGroupLabel };
}
