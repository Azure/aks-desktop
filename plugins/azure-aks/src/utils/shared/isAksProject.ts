// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import type { ApiClient } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/factories';
import type { KubeNamespace } from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import {
  MANAGED_BY_ARM_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
} from '../constants/projectLabels';

type ProjectRef = { namespaces: string[]; clusters: string[] };

/**
 * Fetches namespace labels via a direct HTTP request (no streaming/WebSocket).
 * This avoids stale data from the streaming API when the same namespace name
 * exists across multiple clusters.
 */
async function getNamespaceLabels(
  namespaceName: string,
  cluster: string
): Promise<Record<string, string> | null> {
  try {
    const ns = (await clusterRequest(`/api/v1/namespaces/${encodeURIComponent(namespaceName)}`, {
      cluster,
      method: 'GET',
    })) as KubeNamespace;
    return ns.metadata?.labels ?? {};
  } catch {
    return null;
  }
}

/** Checks if the given project is an AKS Desktop project (managed-by: aks-desktop). */
export const isAksProject = ({ project }: { project: ProjectRef }): Promise<boolean> =>
  new Promise<boolean>(resolve => {
    const cancelFn = (K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>).get(
      project.namespaces[0],
      ns => {
        resolve(ns.metadata?.labels?.[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE);
        void cancelFn.then(cancel => cancel()).catch(() => {});
      },
      () => {
        void cancelFn.then(cancel => cancel()).catch(() => {});
        resolve(false);
      },
      {},
      project.clusters[0]
    );
  });

/** Checks if the given single-cluster, single-namespace project has AKS Desktop resource group context. */
export const isAksProjectWithResourceGroup = async ({
  project,
}: {
  project: ProjectRef;
}): Promise<boolean> => {
  if (project.namespaces.length !== 1 || project.clusters.length !== 1) return false;

  const labels = await getNamespaceLabels(project.namespaces[0], project.clusters[0]);
  if (!labels) return false;
  return (
    labels[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE && !!labels[RESOURCE_GROUP_LABEL]
  );
};

/** Checks if the given project is an AKS Desktop + ARM-managed namespace. */
export const isArmManagedProject = ({ project }: { project: ProjectRef }): Promise<boolean> =>
  new Promise<boolean>(resolve => {
    const cancelFn = (K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>).get(
      project.namespaces[0],
      ns => {
        resolve(
          ns.metadata?.labels?.[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE &&
            ns.metadata?.labels?.[MANAGED_BY_ARM_LABEL] === 'true'
        );
        void cancelFn.then(cancel => cancel()).catch(() => {});
      },
      () => {
        void cancelFn.then(cancel => cancel()).catch(() => {});
        resolve(false);
      },
      {},
      project.clusters[0]
    );
  });
