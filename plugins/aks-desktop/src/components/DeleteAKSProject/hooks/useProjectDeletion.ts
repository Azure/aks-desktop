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
  AUTHZ_MODEL_LABEL,
  MANAGED_BY_ARM_LABEL,
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../../../utils/constants/projectLabels';
import { getClusterSettings } from '../../../utils/shared/clusterSettings';
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

          // AKS Hybrid & Edge (Arc-connected) clusters have no managed-namespace
          // (ARM) resource — their projects are plain Kubernetes namespaces created
          // by applying a manifest. So on these clusters, deletion is a simple
          // Kubernetes delete (or a label-removal), never an `az aks namespace delete`.
          //
          // Decided per namespace from labels on the namespace itself, because they
          // survive anything local: cluster settings live in localStorage, which is
          // absent after the kubeconfig moves to another installation while the
          // namespace persists. Getting this wrong runs `az aks namespace delete`
          // against a connected cluster. Settings remain the fallback for Arc
          // projects created before the model label existed.
          const settingsSayArc = getClusterSettings(project.clusters[0]).clusterType === 'aksarc';

          for (const ns of namespaces) {
            const labels = ns.metadata?.labels || {};
            const isAKSManaged = labels[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE;
            const nsName = ns.metadata?.name || '';
            // An Arc project carries the authorization model we stamped; a managed
            // namespace carries the ARM marker AKS stamps itself.
            const isArcCluster =
              labels[MANAGED_BY_ARM_LABEL] !== 'true' &&
              (!!labels[AUTHZ_MODEL_LABEL] || settingsSayArc);

            if (isAKSManaged && !isArcCluster) {
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
                await (
                  K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>
                ).delete(nsName, {}, project.clusters[0]);
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
