// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import type {
  DiscoveredNamespace,
  UseNamespaceDiscoveryReturn,
} from '../../../hooks/useNamespaceDiscovery';
import { useNamespaceDiscovery } from '../../../hooks/useNamespaceDiscovery';
import { useRegisteredClusters } from '../../../hooks/useRegisteredClusters';
import { registerAKSCluster } from '../../../utils/azure/aks';
import { applyProjectLabels } from '../../../utils/kubernetes/namespaceUtils';
import { getClusterSettings, setClusterSettings } from '../../../utils/shared/clusterSettings';

export interface ImportSelection {
  namespace: DiscoveredNamespace;
}

export interface ImportResult {
  namespace: string;
  clusterName: string;
  success: boolean;
  message: string;
}

/**
 * Return type for the {@link useImportAKSProjects} hook.
 */
interface UseImportAKSProjectsResult {
  error: string;
  success: string;
  namespaces: DiscoveredNamespace[];
  loadingNamespaces: boolean;
  discoveryError: string | null;
  importing: boolean;
  importResults: ImportResult[] | undefined;
  showConversionDialog: boolean;
  namespacesToConvert: DiscoveredNamespace[];
  namespacesToImport: DiscoveredNamespace[];
  refresh: UseNamespaceDiscoveryReturn['refresh'];
  clearError: () => void;
  clearSuccess: () => void;
  clearDiscoveryError: () => void;
  handleImportClick: (selected: ImportSelection[]) => void;
  handleConversionConfirm: () => void;
  handleConversionClose: () => void;
  handleGoToProjects: () => void;
}

/**
 * Manages all state and logic for the Import AKS Projects flow.
 *
 * Discovers namespaces via {@link useNamespaceDiscovery} (managed namespaces via Azure
 * Resource Graph + regular namespaces via the K8s API). Accepts a caller-provided selection,
 * shows a ConversionDialog when non-project namespaces are selected, then orchestrates the
 * import by registering each unique cluster (skipping already-registered ones), applying
 * project labels to namespaces that need conversion, and writing localStorage allowed
 * namespaces.
 */
export const useImportAKSProjects = (): UseImportAKSProjectsResult => {
  const history = useHistory();
  const { t } = useTranslation();
  const registeredClusters = useRegisteredClusters();

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[] | undefined>();

  const [showConversionDialog, setShowConversionDialog] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<ImportSelection[]>([]);

  const {
    namespaces,
    loading: loadingNamespaces,
    error: discoveryError,
    refresh,
  } = useNamespaceDiscovery();

  const [dismissedDiscoveryError, setDismissedDiscoveryError] = useState(false);
  useEffect(() => {
    setDismissedDiscoveryError(false);
  }, [discoveryError]);

  const namespacesToConvert = pendingSelection
    .filter(s => !s.namespace.isAksProject)
    .map(s => s.namespace);
  const namespacesToImport = pendingSelection
    .filter(s => s.namespace.isAksProject)
    .map(s => s.namespace);

  /** Called when user clicks "Import Selected" in the toolbar. */
  const handleImportClick = (selected: ImportSelection[]) => {
    if (selected.length === 0) {
      setError(t('Please select at least one namespace to import'));
      return;
    }

    setPendingSelection(selected);

    if (selected.some(s => !s.namespace.isAksProject)) {
      setShowConversionDialog(true);
    } else {
      void processImport(selected);
    }
  };

  const handleConversionConfirm = () => {
    setShowConversionDialog(false);
    void processImport(pendingSelection);
  };

  const handleConversionClose = () => {
    setShowConversionDialog(false);
    setPendingSelection([]);
  };

  const processImport = async (selectedItems: ImportSelection[]) => {
    setImporting(true);
    setError('');
    setSuccess('');
    setImportResults(undefined);

    try {
      const results: ImportResult[] = [];

      // Build a lookup of cluster -> Azure metadata from ALL discovered namespaces
      // so we have metadata for clusters even when the user only selects regular namespaces.
      const clusterAzureMeta = new Map<string, { resourceGroup: string; subscriptionId: string }>();
      for (const ns of namespaces) {
        if (ns.resourceGroup && ns.subscriptionId && !clusterAzureMeta.has(ns.clusterName)) {
          clusterAzureMeta.set(ns.clusterName, {
            resourceGroup: ns.resourceGroup,
            subscriptionId: ns.subscriptionId,
          });
        }
      }

      // Group selected namespaces by cluster, preferring managed namespace metadata.
      const clusterMap = new Map<
        string,
        {
          clusterName: string;
          resourceGroup: string;
          subscriptionId: string;
          items: DiscoveredNamespace[];
        }
      >();
      for (const { namespace: ns } of selectedItems) {
        const meta = clusterAzureMeta.get(ns.clusterName);
        const existing = clusterMap.get(ns.clusterName);
        if (!existing) {
          clusterMap.set(ns.clusterName, {
            clusterName: ns.clusterName,
            resourceGroup: ns.resourceGroup || meta?.resourceGroup || '',
            subscriptionId: ns.subscriptionId || meta?.subscriptionId || '',
            items: [ns],
          });
        } else {
          existing.items.push(ns);
          if (ns.resourceGroup && ns.subscriptionId && !existing.resourceGroup) {
            existing.resourceGroup = ns.resourceGroup;
            existing.subscriptionId = ns.subscriptionId;
          }
        }
      }

      for (const {
        clusterName,
        resourceGroup,
        subscriptionId,
        items: namespacesInCluster,
      } of clusterMap.values()) {
        try {
          // Register the cluster if it's not already registered in Headlamp.
          // Re-registering overwrites the kubeconfig with namespace-scoped credentials,
          // which would break access to previously imported namespaces on this cluster.
          if (!registeredClusters.has(clusterName)) {
            if (!subscriptionId || !resourceGroup) {
              for (const ns of namespacesInCluster) {
                results.push({
                  namespace: `${ns.name} (${clusterName})`,
                  clusterName,
                  success: false,
                  message: t(
                    'Cluster {{clusterName}} must be registered before importing regular namespaces. Import a managed namespace from this cluster first.',
                    { clusterName }
                  ),
                });
              }
              continue;
            }

            const registerResult = await registerAKSCluster(
              subscriptionId,
              resourceGroup,
              clusterName
            );

            if (!registerResult.success) {
              for (const ns of namespacesInCluster) {
                results.push({
                  namespace: `${ns.name} (${clusterName})`,
                  clusterName,
                  success: false,
                  message: t('Failed to merge cluster: {{message}}', {
                    message: registerResult.message,
                  }),
                });
              }
              continue;
            }
          }

          // Apply project labels to namespaces that need conversion.
          const failedNames = new Set<string>();
          for (const ns of namespacesInCluster) {
            if (ns.isAksProject) continue;

            try {
              await applyProjectLabels({
                namespaceName: ns.name,
                clusterName: ns.clusterName,
                subscriptionId: ns.isManagedNamespace
                  ? ns.subscriptionId || subscriptionId
                  : ns.subscriptionId,
                resourceGroup: ns.isManagedNamespace
                  ? ns.resourceGroup || resourceGroup
                  : ns.resourceGroup,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              failedNames.add(ns.name);
              results.push({
                namespace: `${ns.name} (${clusterName})`,
                clusterName,
                success: false,
                message: t('Failed to convert namespace: {{message}}', { message }),
              });
            }
          }

          // Update allowed namespaces in localStorage.
          const importableInCluster = namespacesInCluster.filter(ns => !failedNames.has(ns.name));
          if (importableInCluster.length > 0) {
            try {
              const settings = getClusterSettings(clusterName);
              settings.allowedNamespaces = [
                ...new Set([
                  ...(settings.allowedNamespaces ?? []),
                  ...importableInCluster.map(ns => ns.name),
                ]),
              ];
              setClusterSettings(clusterName, settings);
            } catch (e) {
              console.error('Failed to update allowed namespaces for cluster ' + clusterName, e);
            }
          }

          for (const ns of importableInCluster) {
            results.push({
              namespace: `${ns.name} (${clusterName})`,
              clusterName,
              success: true,
              message: ns.isAksProject
                ? t("Project '{{name}}' successfully imported", { name: ns.name })
                : t("Namespace '{{name}}' converted and imported as project", { name: ns.name }),
            });
          }
        } catch (err) {
          for (const ns of namespacesInCluster) {
            results.push({
              namespace: `${ns.name} (${clusterName})`,
              clusterName,
              success: false,
              message: err instanceof Error ? err.message : t('Unknown error'),
            });
          }
        }
      }

      setImportResults(results);

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      const successfulClusters = new Set(results.filter(r => r.success).map(r => r.clusterName))
        .size;

      if (successCount > 0) {
        const clusterText = t('Successfully imported from {{count}} cluster(s)', {
          count: successfulClusters,
        });
        const projectText = t('with {{count}} project(s)', { count: successCount });
        const failureSuffix =
          failureCount > 0 ? ` ${t('{{count}} failed.', { count: failureCount })}` : '.';
        setSuccess(`${clusterText} ${projectText}${failureSuffix}`);
      } else {
        setError(t('Failed to import any projects.'));
      }
    } finally {
      setImporting(false);
    }
  };

  const handleGoToProjects = () => {
    history.replace('/');
    window.location.reload();
  };

  return {
    error,
    success,
    namespaces,
    loadingNamespaces,
    discoveryError: dismissedDiscoveryError ? null : discoveryError,
    importing,
    importResults,
    showConversionDialog,
    namespacesToConvert,
    namespacesToImport,
    refresh,
    clearError: () => setError(''),
    clearSuccess: () => setSuccess(''),
    clearDiscoveryError: () => setDismissedDiscoveryError(true),
    handleImportClick,
    handleConversionConfirm,
    handleConversionClose,
    handleGoToProjects,
  };
};
