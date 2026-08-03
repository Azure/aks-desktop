// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { apply } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import type { ApiClient } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/factories';
import type { KubeNamespace } from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import { runCommandAsync } from '../azure/az-cli-core';
import {
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../constants/projectLabels';
import {
  generateNamespaceManifestObjects,
  type GenerateNamespaceManifestOptions,
} from './namespaceManifest';

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
 * Applies a native Kubernetes namespace manifest (Namespace + ResourceQuota +
 * NetworkPolicy + RoleBindings) to a cluster via the Headlamp K8s API.
 *
 * This is the AKS Hybrid & Edge (Arc) counterpart to `createManagedNamespace`
 * (`az aks namespace add`): Arc clusters have no `az aks namespace` surface, so
 * the same wizard inputs are turned into native objects and applied through the
 * cluster's kubeconfig context.
 *
 * Each object is applied with Headlamp's own `apply()` helper — the same one its
 * "apply YAML" flow uses — which resolves the API endpoint from the object's
 * `apiVersion`/`kind` (so any kind works, no hand-maintained kind map) and does
 * create-or-update (POST, then PUT on a 409/403 conflict). Re-applying an
 * existing project therefore updates rather than failing on a conflict.
 *
 * Objects are applied in manifest order — the `Namespace` first, then its
 * namespaced children — and the call fails fast on the first error, so a failure
 * can leave partially-created resources; callers should surface the error.
 *
 * @param clusterName - Headlamp cluster (kubeconfig context) name to target.
 * @param options - Manifest inputs; mirrors the managed-namespace option surface.
 * @returns `{ success, error? }`, shaped like `createManagedNamespace`.
 */
export async function applyNamespaceManifest(
  clusterName: string,
  options: GenerateNamespaceManifestOptions
): Promise<{ success: boolean; error?: string }> {
  const objects = generateNamespaceManifestObjects(options);

  for (const obj of objects) {
    try {
      await apply(obj as any, clusterName);
    } catch (error) {
      const kind = (obj.kind as string) || 'resource';
      const name = (obj.metadata as { name?: string })?.name ?? '';
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to apply ${kind} "${name}": ${message}` };
    }
  }

  return { success: true };
}

/**
 * Applies AKS Desktop project labels to an existing namespace.
 *
 * For managed namespaces (those with subscriptionId/resourceGroup), labels are applied
 * via `az aks namespace update` because AKS admission webhooks block direct K8s API
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
    const labelPairs = [
      `${PROJECT_ID_LABEL}=${namespaceName}`,
      `${PROJECT_MANAGED_BY_LABEL}=${PROJECT_MANAGED_BY_VALUE}`,
      `${SUBSCRIPTION_LABEL}=${subscriptionId}`,
      `${RESOURCE_GROUP_LABEL}=${resourceGroup}`,
    ];

    const { stderr } = await runCommandAsync('az', [
      'aks',
      'namespace',
      'update',
      '--resource-group',
      resourceGroup,
      '--cluster-name',
      clusterName,
      '--name',
      namespaceName,
      '--subscription',
      subscriptionId,
      '--labels',
      ...labelPairs,
    ]);

    if (stderr && stderr.includes('ERROR')) {
      throw new Error(stderr);
    }
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
