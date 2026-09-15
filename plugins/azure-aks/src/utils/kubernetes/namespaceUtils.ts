// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ContainerServiceClient } from '@azure/arm-containerservice';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { ApiClient } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/factories';
import type { KubeNamespace } from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import { azureCredential } from '../../azureAuth';
import {
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../constants/projectLabels';

/**
 * Fetches a namespace object via the Headlamp K8s API.
 */
export function fetchNamespaceData(name: string, cluster: string): Promise<KubeNamespace> {
  return new Promise((resolve, reject) => {
    const cancelFn = (K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>).get(
      name,
      ns => {
        void cancelFn.then(cancel => cancel()).catch(() => {});
        resolve(ns);
      },
      (err: any) => {
        void cancelFn.then(cancel => cancel()).catch(() => {});
        reject(new Error(`Failed to fetch namespace: ${err}`));
      },
      {},
      cluster
    );
  });
}

/**
 * Creates a new Kubernetes namespace with AKS Desktop project labels on the given cluster.
 */
export async function createNamespaceAsProject(
  namespaceName: string,
  clusterName: string
): Promise<void> {
  const nsBody = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: namespaceName,
      labels: {
        [PROJECT_ID_LABEL]: namespaceName,
        [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
      },
    },
  };

  await (K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>).post(
    nsBody,
    {},
    clusterName
  );
}

/**
 * Applies AKS Desktop project labels to an existing namespace.
 *
 * For managed namespaces (those with subscriptionId/resourceGroup), labels are applied
 * via the ARM ContainerService API because AKS admission webhooks block direct K8s API
 * label updates on managed namespaces.
 *
 * For regular namespaces, labels are applied via the K8s API.
 */
export async function applyProjectLabels(options: {
  namespaceName: string;
  clusterName: string;
  subscriptionId: string;
  resourceGroup: string;
}): Promise<void> {
  const { namespaceName, clusterName, subscriptionId, resourceGroup } = options;

  const isManagedNamespace = !!subscriptionId && !!resourceGroup;

  if (isManagedNamespace) {
    const client = new ContainerServiceClient(azureCredential, subscriptionId);

    const existing = await client.managedNamespaces.get(resourceGroup, clusterName, namespaceName);

    await client.managedNamespaces.beginCreateOrUpdateAndWait(
      resourceGroup,
      clusterName,
      namespaceName,
      {
        ...existing,
        properties: {
          ...existing.properties,
          labels: {
            ...existing.properties?.labels,
            [PROJECT_ID_LABEL]: namespaceName,
            [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
            [SUBSCRIPTION_LABEL]: subscriptionId,
            [RESOURCE_GROUP_LABEL]: resourceGroup,
          },
        },
      }
    );
  } else {
    const nsData = await fetchNamespaceData(namespaceName, clusterName);

    const updatedData = { ...nsData };
    updatedData.metadata = { ...updatedData.metadata };
    updatedData.metadata.labels = {
      ...updatedData.metadata.labels,
      [PROJECT_ID_LABEL]: namespaceName,
      [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
    };

    await K8s.ResourceClasses.Namespace.apiEndpoint.put(updatedData, {}, clusterName);
  }
}
