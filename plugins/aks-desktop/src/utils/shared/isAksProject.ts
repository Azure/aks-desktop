// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import type { ApiClient } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/factories';
import type { KubeNamespace } from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import {
  AUTHZ_MODEL_AZURE_RBAC,
  AUTHZ_MODEL_LABEL,
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

/**
 * Whether the plugin owns this project's deletion.
 *
 * True for the namespaces the plugin creates, whichever kind: an ARM-managed
 * namespace on managed AKS, or an Arc project, which has no ARM resource and so
 * carries the authorization model we stamp instead of the ARM marker. Arc
 * projects need this as much as managed ones — more so, since deleting them
 * requires native Kubernetes calls rather than `az aks namespace delete`.
 */
export const isArmManagedProject = ({ project }: { project: ProjectRef }): Promise<boolean> =>
  new Promise<boolean>(resolve => {
    const cancelFn = (K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>).get(
      project.namespaces[0],
      ns => {
        const labels = ns.metadata?.labels ?? {};
        resolve(
          labels[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE &&
            (labels[MANAGED_BY_ARM_LABEL] === 'true' || !!labels[AUTHZ_MODEL_LABEL])
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

/**
 * Whether this project's access is granted by **Azure role assignments** rather
 * than Kubernetes RoleBindings — i.e. whether the Access tab should list Azure
 * roles instead of in-cluster RBAC objects.
 *
 * True for two different kinds of project:
 *
 * - **Managed AKS** managed namespaces, marked by AKS itself with
 *   {@link MANAGED_BY_ARM_LABEL}.
 * - **Arc clusters created with Azure RBAC**, marked by us with
 *   {@link AUTHZ_MODEL_LABEL} — AKS never touches an Arc namespace, so there is
 *   no ARM label to key on, and the model cannot be re-derived from the namespace
 *   because it is a property of the cluster.
 *
 * Arc projects on a cluster using native Kubernetes RBAC are deliberately false:
 * their grants really are RoleBindings, so the built-in tab is the correct view.
 */
export const isAzureRbacProject = async ({
  project,
}: {
  project: ProjectRef;
}): Promise<boolean> => {
  if (project.namespaces.length !== 1 || project.clusters.length !== 1) return false;

  const labels = await getNamespaceLabels(project.namespaces[0], project.clusters[0]);
  if (!labels || labels[PROJECT_MANAGED_BY_LABEL] !== PROJECT_MANAGED_BY_VALUE) return false;

  return (
    labels[MANAGED_BY_ARM_LABEL] === 'true' || labels[AUTHZ_MODEL_LABEL] === AUTHZ_MODEL_AZURE_RBAC
  );
};
