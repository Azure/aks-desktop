// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterAction, K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import type { ApiClient } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/factories';
import type { KubeNamespace } from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import Namespace from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import { trackError } from '../../../telemetry';
import { trackAksFeature } from '../../../telemetry/aksFeature';
import { deleteManagedNamespace } from '../../../utils/azure/az-namespaces';
import {
  MANAGED_BY_ARM_LABEL,
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../../../utils/constants/projectLabels';
import type { ProjectDefinition } from '../AKSProjectDeleteButton';

/**
 * @param error - Kubernetes API failure from deletion or post-ARM label refetch.
 * @returns True only for status=404; permission/server failures must still surface.
 */
function isNotFound(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 404;
}

/**
 * Returns a `handleDelete` callback that asynchronously deletes a project and its namespaces
 * Redirects to `/` on success.
 * @returns The deletion handler. Its immediate return does not imply completion:
 * clusterAction owns asynchronous progress/error reporting and success navigation.
 */
export function useProjectDeletion() {
  const { t } = useTranslation();

  /**
   * @param project - Project identity, namespaces and registered cluster context.
   * @param deleteNamespaces - Whether to explicitly delete Kubernetes namespaces;
   * an owned ARM resource's existing Delete policy may remove one even when false.
   * @param onClose - Invoked immediately after scheduling, not after remote cleanup.
   * @returns Nothing. Owned ARM namespaces are deleted through REST; native/Arc or
   * imported projects retain their existing Kubernetes deletion/label-removal paths.
   * Refetch404 is completed absence; other cleanup failures reach clusterAction.
   */
  const handleDelete = (
    project: ProjectDefinition,
    deleteNamespaces: boolean,
    onClose: () => void
  ) => {
    trackAksFeature('aksd.project-delete', 'started');
    clusterAction(
      async () => {
        try {
          const namespacePromises = project.namespaces.map(
            nsName =>
              new Promise<Namespace | null>(resolve => {
                K8s.ResourceClasses.Namespace.apiGet(
                  (ns: Namespace) => resolve(ns),
                  nsName,
                  undefined,
                  () => resolve(null),
                  { cluster: project.clusters[0] }
                )();
              })
          );

          const namespaces = (await Promise.all(namespacePromises)).filter(
            (ns): ns is Namespace => ns !== null
          );

          for (const ns of namespaces) {
            const labels = ns.metadata?.labels || {};
            const isAKSManaged = labels[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE;
            const nsName = ns.metadata?.name || '';
            // Only AKS's durable ARM marker authorizes a managed-resource delete.
            // Project ownership alone also appears on native/Arc namespaces.
            if (isAKSManaged && labels[MANAGED_BY_ARM_LABEL] === 'true') {
              const resourceGroup = labels[RESOURCE_GROUP_LABEL];
              const subscriptionId = labels[SUBSCRIPTION_LABEL];

              if (!resourceGroup || !subscriptionId) {
                throw new Error(
                  `Missing required Azure labels on namespace '${nsName}' for managed deletion.`
                );
              }

              // Delete ARM managed namespace
              const result = await deleteManagedNamespace({
                clusterName: project.clusters[0],
                resourceGroup,
                namespaceName: nsName,
                subscriptionId,
              });

              if (!result.success) {
                throw new Error(result.error || 'Failed to delete managed namespace');
              }

              if (deleteNamespaces) {
                // Delete the Kubernetes namespace
                try {
                  await (
                    K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>
                  ).delete(nsName, {}, project.clusters[0]);
                } catch (error) {
                  // ARM's Delete policy may already have removed the namespace.
                  if (!isNotFound(error)) throw error;
                }
              } else {
                // Re-fetch namespace to get latest resourceVersion after ARM call modified it
                const freshNs = await new Promise<Namespace | null>((resolve, reject) => {
                  K8s.ResourceClasses.Namespace.apiGet(
                    (ns: Namespace) => resolve(ns),
                    nsName,
                    undefined,
                    (error: unknown) => (isNotFound(error) ? resolve(null) : reject(error)),
                    { cluster: project.clusters[0] }
                  )();
                });
                // ARM's existing Delete policy may remove it even when only
                // project-label removal was requested.
                if (!freshNs) continue;

                // Remove project labels from namespace
                const updatedData = { ...freshNs.jsonData };
                if (updatedData.metadata?.labels) {
                  delete updatedData.metadata.labels[PROJECT_ID_LABEL];
                  delete updatedData.metadata.labels[PROJECT_MANAGED_BY_LABEL];
                  delete updatedData.metadata.labels[SUBSCRIPTION_LABEL];
                  delete updatedData.metadata.labels[RESOURCE_GROUP_LABEL];
                }
                await K8s.ResourceClasses.Namespace.apiEndpoint.put(
                  updatedData,
                  {},
                  project.clusters[0]
                );
              }
            } else {
              // Native Kubernetes namespace — either a regular (non-AKS) namespace or
              // an AKS Hybrid & Edge (Arc-connected) project. No ARM resource to
              // delete, so operate directly on the cluster: delete the namespace
              // (cascades to its ResourceQuota / NetworkPolicy / RoleBindings) or just
              // strip the project labels to un-project it.
              if (deleteNamespaces) {
                await ns.delete();
              } else {
                // Un-project with a merge patch that clears just the project labels
                // (a `null` value deletes the key). This sends only these keys — not a
                // full rewrite of the namespace — and reuses the object's own cluster
                // context. Clearing an absent label is a harmless no-op.
                await ns.patch({
                  metadata: {
                    labels: {
                      [PROJECT_ID_LABEL]: null,
                      [PROJECT_MANAGED_BY_LABEL]: null,
                    },
                  },
                } as any);
              }
            }
          }

          trackAksFeature('aksd.project-delete', 'succeeded');
        } catch (error) {
          trackAksFeature('aksd.project-delete', 'failed');
          trackError({ area: 'project-delete', errorClass: 'UnknownError', phase: 'failed' });
          throw error;
        }
      },
      {
        startMessage: t('Deleting project {{ projectId }}…', { projectId: project.id }),
        cancelledMessage: t('Cancelled deletion of project {{ projectId }}.', {
          projectId: project.id,
        }),
        successMessage: t('Deleted project {{ projectId }}.', { projectId: project.id }),
        errorMessage: t('Error deleting project {{ projectId }}.', { projectId: project.id }),
        startOptions: { autoHideDuration: null },
        successUrl: '/',
      }
    );

    onClose();
  };

  return { handleDelete };
}
