// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterAction, K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import type { ApiClient } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/factories';
import type { KubeNamespace } from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import Namespace from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import { deleteManagedNamespace } from '../../../utils/azure/az-cli';
import {
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../../../utils/constants/projectLabels';
import type { ProjectDefinition } from '../AKSProjectDeleteButton';

/**
 * Returns a `handleDelete` callback that asynchronously deletes a project and its namespaces
 * Redirects to `/` on success.
 */
export function useProjectDeletion() {
  const { t } = useTranslation();

  const handleDelete = (
    project: ProjectDefinition,
    deleteNamespaces: boolean,
    onClose: () => void
  ) => {
    clusterAction(
      async () => {
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

          if (isAKSManaged) {
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
              await (K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>).delete(
                nsName,
                {},
                project.clusters[0]
              );
            } else {
              // Re-fetch namespace to get latest resourceVersion after ARM call modified it
              const freshNs = await new Promise<Namespace>((resolve, reject) => {
                K8s.ResourceClasses.Namespace.apiGet(
                  (ns: Namespace) => resolve(ns),
                  nsName,
                  undefined,
                  (err: any) => reject(err),
                  { cluster: project.clusters[0] }
                )();
              });

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
            // Regular namespace (not AKS managed)
            if (deleteNamespaces) {
              await ns.delete();
            } else {
              // Remove project labels
              const updatedData = { ...ns.jsonData };
              if (updatedData.metadata?.labels) {
                delete updatedData.metadata.labels[PROJECT_ID_LABEL];
                delete updatedData.metadata.labels[PROJECT_MANAGED_BY_LABEL];
              }
              await K8s.ResourceClasses.Namespace.apiEndpoint.put(
                updatedData,
                {},
                project.clusters[0]
              );
            }
          }
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
