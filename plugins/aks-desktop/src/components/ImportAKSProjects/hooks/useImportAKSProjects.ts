// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import type {
  DiscoveredNamespace,
  UseNamespaceDiscoveryReturn,
} from '../../../hooks/useNamespaceDiscovery';
import { useNamespaceDiscovery } from '../../../hooks/useNamespaceDiscovery';
import { useRegisteredClusters } from '../../../hooks/useRegisteredClusters';
import { trackError, trackFeature } from '../../../telemetry';
import { registerAKSCluster } from '../../../utils/azure/aks';
import { normalizeClusterName } from '../../../utils/kubernetes/k8sNames';
import { applyProjectLabels } from '../../../utils/kubernetes/namespaceUtils';
import { getClusterSettings, setClusterSettings } from '../../../utils/shared/clusterSettings';

/** Telemetry must never interrupt the import flow, so swallow any reporting errors. */
function safelyTrackFeature(properties: Parameters<typeof trackFeature>[0]) {
  try {
    trackFeature(properties);
  } catch {}
}

function safelyTrackError(properties: Parameters<typeof trackError>[0]) {
  try {
    trackError(properties);
  } catch {}
}

/** A discovered namespace selected for import. */
export interface ImportSelection {
  /** Namespace and Azure scope metadata used by the import workflow. */
  namespace: DiscoveredNamespace;
}

/** Outcome of importing one namespace. */
export interface ImportResult {
  /** Display label identifying the namespace and its cluster. */
  namespace: string;
  /** Cluster containing the imported namespace. */
  clusterName: string;
  /** Whether the namespace was imported successfully. */
  success: boolean;
  /** Localized outcome details shown to the user. */
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
  registeredClustersReady: boolean;
  importing: boolean;
  importProgress: string;
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
  handleCancel: () => void;
  handleGoToProjects: () => void;
}

interface UseImportAKSProjectsOptions {
  reloadPage?: () => void;
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
export const useImportAKSProjects = ({
  reloadPage = () => window.location.reload(),
}: UseImportAKSProjectsOptions = {}): UseImportAKSProjectsResult => {
  const history = useHistory();
  const { t } = useTranslation();
  const { registeredClusters, isReady: registeredClustersReady } = useRegisteredClusters();

  // Tracks clusters successfully registered during this hook's lifetime. Because the page
  // allows retrying after an all-failure import, `registeredClusters` (a snapshot from
  // Headlamp) won't reflect clusters registered earlier in the same session. Re-registering
  // would overwrite the kubeconfig with namespace-scoped credentials, so we skip clusters
  // recorded here on subsequent attempts.
  const sessionRegisteredClusters = useRef<
    Map<string, { subscriptionId: string; resourceGroup: string }>
  >(new Map());

  // Guards terminal telemetry so an attempt reports only one terminal status.
  const terminalTrackedRef = useRef(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
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

  useEffect(() => {
    safelyTrackFeature({ feature: 'aksd.project-import', status: 'opened' });
  }, []);

  const namespacesToConvert = pendingSelection
    .filter(s => !s.namespace.isAksProject)
    .map(s => s.namespace);
  const namespacesToImport = pendingSelection
    .filter(s => s.namespace.isAksProject)
    .map(s => s.namespace);

  /** Called when user clicks "Import Selected" in the toolbar. */
  const handleImportClick = (selected: ImportSelection[]) => {
    if (!registeredClustersReady) {
      return;
    }
    if (selected.length === 0) {
      setError(t('Please select at least one namespace to import'));
      return;
    }

    // Start of a new attempt — allow a fresh terminal telemetry event to be reported.
    terminalTrackedRef.current = false;

    setPendingSelection(selected);

    if (selected.some(s => !s.namespace.isAksProject)) {
      setShowConversionDialog(true);
    } else {
      void processImport(selected);
    }
  };

  const handleConversionConfirm = () => {
    if (!registeredClustersReady) {
      return;
    }
    setShowConversionDialog(false);
    void processImport(pendingSelection);
  };

  const handleConversionClose = () => {
    if (!terminalTrackedRef.current) {
      terminalTrackedRef.current = true;
      safelyTrackFeature({ feature: 'aksd.project-import', status: 'cancelled' });
    }
    setShowConversionDialog(false);
    setPendingSelection([]);
  };

  const handleCancel = () => {
    if (!terminalTrackedRef.current) {
      terminalTrackedRef.current = true;
      safelyTrackFeature({ feature: 'aksd.project-import', status: 'cancelled' });
    }
    history.push('/');
  };

  const processImport = async (selectedItems: ImportSelection[]) => {
    safelyTrackFeature({ feature: 'aksd.project-import', status: 'started' });
    setImporting(true);
    setError('');
    setSuccess('');
    setImportProgress(`${t('Importing')}...`);
    setImportResults(undefined);

    try {
      const results: ImportResult[] = [];

      // Build a lookup of cluster -> Azure metadata from ALL discovered namespaces
      // so we have metadata for clusters even when the user only selects regular namespaces.
      const clusterAzureMeta = new Map<string, { resourceGroup: string; subscriptionId: string }>();
      const ambiguousAzureMetadataNames = new Set<string>();
      for (const ns of namespaces) {
        if (ns.resourceGroup && ns.subscriptionId) {
          const normalizedClusterName = normalizeClusterName(ns.clusterName);
          const existing = clusterAzureMeta.get(normalizedClusterName);
          if (
            existing &&
            (existing.resourceGroup !== ns.resourceGroup ||
              existing.subscriptionId !== ns.subscriptionId)
          ) {
            ambiguousAzureMetadataNames.add(normalizedClusterName);
          } else if (!existing) {
            clusterAzureMeta.set(normalizedClusterName, {
              resourceGroup: ns.resourceGroup,
              subscriptionId: ns.subscriptionId,
            });
          }
        }
      }

      // Group selected namespaces by cluster, preferring managed namespace metadata.
      const clusterMap = new Map<
        string,
        {
          key: { clusterName: string; resourceGroup: string; subscriptionId: string };
          items: DiscoveredNamespace[];
        }
      >();
      const clusterKeyByName = new Map<string, string>();
      const conflictingClusterNames = new Set<string>();
      for (const { namespace: ns } of selectedItems) {
        const normalizedClusterName = normalizeClusterName(ns.clusterName);
        const meta = clusterAzureMeta.get(normalizedClusterName);
        if (
          (!ns.resourceGroup || !ns.subscriptionId) &&
          ambiguousAzureMetadataNames.has(normalizedClusterName)
        ) {
          conflictingClusterNames.add(normalizedClusterName);
        }
        const resourceGroup = ns.resourceGroup || meta?.resourceGroup || '';
        const subscriptionId = ns.subscriptionId || meta?.subscriptionId || '';
        const clusterKey = `${subscriptionId}\0${resourceGroup}\0${normalizedClusterName}`;
        const existingClusterKey = clusterKeyByName.get(normalizedClusterName);
        if (existingClusterKey && existingClusterKey !== clusterKey) {
          conflictingClusterNames.add(normalizedClusterName);
        } else if (!existingClusterKey) {
          clusterKeyByName.set(normalizedClusterName, clusterKey);
        }
        const existing = clusterMap.get(clusterKey);
        if (!existing) {
          clusterMap.set(clusterKey, {
            key: { clusterName: ns.clusterName, resourceGroup, subscriptionId },
            items: [ns],
          });
        } else {
          existing.items.push(ns);
          if (ns.resourceGroup && ns.subscriptionId && !existing.key.resourceGroup) {
            existing.key.resourceGroup = ns.resourceGroup;
            existing.key.subscriptionId = ns.subscriptionId;
          }
        }
      }

      for (const {
        key: { clusterName, resourceGroup, subscriptionId },
        items: namespacesInCluster,
      } of clusterMap.values()) {
        try {
          const normalizedClusterName = normalizeClusterName(clusterName);
          if (conflictingClusterNames.has(normalizedClusterName)) {
            for (const ns of namespacesInCluster) {
              results.push({
                namespace: `${ns.name} (${clusterName})`,
                clusterName,
                success: false,
                message: t(
                  'Cannot import projects with the same cluster name in different Azure scopes because their kubeconfig entries would overwrite each other.'
                ),
              });
            }
            continue;
          }

          // Register the cluster if it's not already registered in Headlamp.
          // Re-registering overwrites the kubeconfig with namespace-scoped credentials,
          // which would break access to previously imported namespaces on this cluster.
          const sessionRegistration = sessionRegisteredClusters.current.get(normalizedClusterName);
          const clusterIsRegistered =
            registeredClusters.has(normalizedClusterName) || sessionRegistration !== undefined;
          if (clusterIsRegistered && subscriptionId && resourceGroup) {
            const settings = getClusterSettings(clusterName);
            const registeredScope = sessionRegistration ?? settings.azureRegistration;
            const scopeIsKnown =
              typeof registeredScope?.subscriptionId === 'string' &&
              registeredScope.subscriptionId !== '' &&
              typeof registeredScope.resourceGroup === 'string' &&
              registeredScope.resourceGroup !== '';
            const scopeConflicts =
              (sessionRegistration === undefined && settings.clusterType === 'aksarc') ||
              (scopeIsKnown &&
                (registeredScope.subscriptionId.toLowerCase() !== subscriptionId.toLowerCase() ||
                  registeredScope.resourceGroup.toLowerCase() !== resourceGroup.toLowerCase()));
            if (scopeConflicts) {
              for (const ns of namespacesInCluster) {
                results.push({
                  namespace: `${ns.name} (${clusterName})`,
                  clusterName,
                  success: false,
                  message: t(
                    'Cluster {{clusterName}} is already registered with a different cluster kind or Azure scope. Remove and register it again before importing these projects.',
                    { clusterName }
                  ),
                });
              }
              continue;
            }
            if (!scopeIsKnown) {
              setClusterSettings(clusterName, {
                ...settings,
                azureRegistration: { subscriptionId, resourceGroup },
              });
            }
          } else if (!clusterIsRegistered) {
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

            setImportProgress(`${t('Registering cluster')}: ${clusterName}`);
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

            // Remember this cluster so a retry after a partial/total failure does not
            // re-register it (which would overwrite its kubeconfig credentials).
            sessionRegisteredClusters.current.set(normalizedClusterName, {
              subscriptionId,
              resourceGroup,
            });
          }

          // Apply project labels to namespaces that need conversion.
          const failedNames = new Set<string>();
          for (const ns of namespacesInCluster) {
            if (ns.isAksProject) continue;

            try {
              setImportProgress(`${t('Converting')}: ${ns.name}`);
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

          // Update allowed namespaces in localStorage — only if the user already has an
          // allowedNamespaces restriction configured. Creating a new restriction as a
          // side-effect of import would hide every other project the user can see (see #489).
          const importableInCluster = namespacesInCluster.filter(ns => !failedNames.has(ns.name));
          if (importableInCluster.length > 0) {
            try {
              const settings = getClusterSettings(clusterName);
              const existing = settings.allowedNamespaces;
              if (existing && existing.length > 0) {
                settings.allowedNamespaces = [
                  ...new Set([...existing, ...importableInCluster.map(ns => ns.name)]),
                ];
                setClusterSettings(clusterName, settings);
              }
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
        const clusterText = t('Successfully merged {{count}} cluster(s)', {
          count: successfulClusters,
        });
        const projectText = t('with {{count}} project(s)', { count: successCount });
        const failureSuffix =
          failureCount > 0 ? ` ${t('{{count}} failed.', { count: failureCount })}` : '.';
        setSuccess(`${clusterText} ${projectText}${failureSuffix}`);
      } else {
        setError(t('Failed to import any projects. See details below.'));
      }

      // Report the terminal outcome of this import attempt.
      terminalTrackedRef.current = true;
      if (failureCount === 0 && successCount > 0) {
        safelyTrackFeature({ feature: 'aksd.project-import', status: 'succeeded' });
      } else if (successCount > 0) {
        safelyTrackFeature({ feature: 'aksd.project-import', status: 'completed' });
        safelyTrackError({
          area: 'project-import',
          errorClass: 'UnknownError',
          phase: 'completed',
        });
      } else {
        safelyTrackFeature({ feature: 'aksd.project-import', status: 'failed' });
        safelyTrackError({
          area: 'project-import',
          errorClass: 'UnknownError',
          phase: 'failed',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('Unknown error');
      setImportResults(
        selectedItems.map(({ namespace: ns }) => ({
          namespace: `${ns.name} (${ns.clusterName})`,
          clusterName: ns.clusterName,
          success: false,
          message,
        }))
      );
      setError(t('Failed to import any projects. See details below.'));
      if (!terminalTrackedRef.current) {
        terminalTrackedRef.current = true;
        safelyTrackFeature({ feature: 'aksd.project-import', status: 'failed' });
        safelyTrackError({
          area: 'project-import',
          errorClass: 'UnknownError',
          phase: 'failed',
        });
      }
    } finally {
      setImporting(false);
      setImportProgress('');
    }
  };

  const handleGoToProjects = () => {
    history.replace('/');
    reloadPage();
  };

  return {
    error,
    success,
    namespaces,
    loadingNamespaces,
    discoveryError: dismissedDiscoveryError ? null : discoveryError,
    registeredClustersReady,
    importing,
    importProgress,
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
    handleCancel,
    handleGoToProjects,
  };
};
