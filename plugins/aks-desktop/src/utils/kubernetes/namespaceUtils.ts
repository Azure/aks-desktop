// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';

const PROJECT_ID_LABEL = 'headlamp.dev/project-id';
const PROJECT_MANAGED_BY_LABEL = 'headlamp.dev/project-managed-by';
const PROJECT_MANAGED_BY_VALUE = 'aks-desktop';
const SUBSCRIPTION_LABEL = 'aks-desktop/project-subscription';
const RESOURCE_GROUP_LABEL = 'aks-desktop/project-resource-group';

/**
 * Fetches a namespace object via the Headlamp K8s API.
 */
export function fetchNamespaceData(name: string, cluster: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const cancelFn = K8s.ResourceClasses.Namespace.apiEndpoint.get(
      name,
      // @ts-ignore todo: not sure what the issue is here.
      (ns: any) => {
        resolve(ns.jsonData ?? ns);
        cancelFn.then((cancel: () => void) => cancel());
      },
      (err: any) => {
        reject(new Error(`Failed to fetch namespace: ${err}`));
      },
      {},
      cluster
    );
  });
}

/**
 * Applies AKS Desktop project labels to an existing namespace via the K8s API.
 * This converts a managed namespace into a Headlamp project.
 */
export async function applyProjectLabels(options: {
  namespaceName: string;
  clusterName: string;
  subscriptionId: string;
  resourceGroup: string;
}): Promise<void> {
  const { namespaceName, clusterName, subscriptionId, resourceGroup } = options;

  const nsData = await fetchNamespaceData(namespaceName, clusterName);

  const updatedData = { ...nsData };
  updatedData.metadata = { ...updatedData.metadata };
  updatedData.metadata.labels = {
    ...updatedData.metadata.labels,
    [PROJECT_ID_LABEL]: namespaceName,
    [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
    [SUBSCRIPTION_LABEL]: subscriptionId,
    [RESOURCE_GROUP_LABEL]: resourceGroup,
  };

  await K8s.ResourceClasses.Namespace.apiEndpoint.put(updatedData, {}, clusterName);
}
