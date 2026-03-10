// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { PageGrid, SectionBox, Table } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { DiscoveredNamespace, useNamespaceDiscovery } from '../../hooks/useNamespaceDiscovery';
import { useRegisteredClusters } from '../../hooks/useRegisteredClusters';
import { registerAKSCluster } from '../../utils/azure/aks';
import { applyProjectLabels } from '../../utils/kubernetes/namespaceUtils';
import { getClusterSettings, setClusterSettings } from '../../utils/shared/clusterSettings';
import AzureAuthGuard from '../AzureAuth/AzureAuthGuard';
import { ConversionDialog } from './components/ConversionDialog';

interface ImportSelection {
  namespace: DiscoveredNamespace;
  selected: boolean;
}

function ImportAKSProjectsContent() {
  const history = useHistory();
  const { t } = useTranslation();
  const registeredClusters = useRegisteredClusters();

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Discovery
  const {
    namespaces: discovered,
    loading: loadingNamespaces,
    error: discoveryError,
    refresh,
  } = useNamespaceDiscovery();

  // Allow user to dismiss discoveryError
  const [dismissedDiscoveryError, setDismissedDiscoveryError] = useState(false);
  useEffect(() => {
    setDismissedDiscoveryError(false);
  }, [discoveryError]);

  // Selection state layered on top of discovered namespaces
  const [selections, setSelections] = useState<Set<string>>(new Set());

  // Derive selectable list from discovered namespaces
  const namespaces: ImportSelection[] = discovered.map(ns => ({
    namespace: ns,
    selected: selections.has(`${ns.clusterName}/${ns.name}`),
  }));

  const selectedNamespaces = namespaces.filter(ns => ns.selected);
  const selectedCount = selectedNamespaces.length;

  // Conversion dialog
  const [showConversionDialog, setShowConversionDialog] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importResults, setImportResults] = useState<
    Array<{ namespace: string; clusterName: string; success: boolean; message: string }> | undefined
  >();

  const toggleSelection = (ns: DiscoveredNamespace) => {
    setSelections(prev => {
      const key = `${ns.clusterName}/${ns.name}`;
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelections(new Set(discovered.map(ns => `${ns.clusterName}/${ns.name}`)));
  };

  const deselectAll = () => {
    setSelections(new Set());
  };

  const handleCancel = () => {
    history.push('/');
  };

  /** Called when user clicks "Import Selected" */
  const handleImportClick = () => {
    if (selectedCount === 0) {
      setError(t('Please select at least one namespace to import'));
      return;
    }

    const needsConversion = selectedNamespaces.filter(s => !s.namespace.isAksProject);

    if (needsConversion.length > 0) {
      // Show confirmation dialog for namespaces that need label conversion
      setShowConversionDialog(true);
    } else {
      // All selected are already AKS projects — import directly
      processImport();
    }
  };

  /** Process the import (called after confirmation if conversion needed) */
  const processImport = async () => {
    setShowConversionDialog(false);
    setImporting(true);
    setError('');
    setSuccess('');
    setImportResults(undefined);

    const results: Array<{
      namespace: string;
      clusterName: string;
      success: boolean;
      message: string;
    }> = [];

    // Build a lookup of cluster -> Azure metadata from ALL discovered namespaces
    // (not just selected). This ensures we have Azure metadata for clusters even
    // when the user only selects namespaces that were discovered via K8s API.
    const clusterAzureMeta = new Map<string, { resourceGroup: string; subscriptionId: string }>();
    for (const ns of discovered) {
      if (ns.resourceGroup && ns.subscriptionId && !clusterAzureMeta.has(ns.clusterName)) {
        clusterAzureMeta.set(ns.clusterName, {
          resourceGroup: ns.resourceGroup,
          subscriptionId: ns.subscriptionId,
        });
      }
    }

    // Step 1: Group all selected namespaces by cluster, preferring managed namespace metadata
    const clusterMap = new Map<
      string,
      {
        key: { clusterName: string; resourceGroup: string; subscriptionId: string };
        namespaces: DiscoveredNamespace[];
      }
    >();
    for (const item of selectedNamespaces) {
      const ns = item.namespace;
      const meta = clusterAzureMeta.get(ns.clusterName);
      const existing = clusterMap.get(ns.clusterName);
      if (!existing) {
        clusterMap.set(ns.clusterName, {
          key: {
            clusterName: ns.clusterName,
            resourceGroup: ns.resourceGroup || meta?.resourceGroup || '',
            subscriptionId: ns.subscriptionId || meta?.subscriptionId || '',
          },
          namespaces: [ns],
        });
      } else {
        existing.namespaces.push(ns);
        // Prefer managed namespace metadata (non-empty resourceGroup/subscriptionId)
        if (ns.resourceGroup && ns.subscriptionId && !existing.key.resourceGroup) {
          existing.key.resourceGroup = ns.resourceGroup;
          existing.key.subscriptionId = ns.subscriptionId;
        }
      }
    }

    // Step 2: Register clusters, convert namespaces, and import — per cluster
    let processedCount = 0;
    const totalCount = selectedNamespaces.length;
    for (const {
      key: { clusterName, resourceGroup, subscriptionId },
      namespaces: namespacesInCluster,
    } of clusterMap.values()) {
      try {
        // 2a: Register the cluster if it's not already registered in Headlamp.
        // Re-registering with a managedNamespace param overwrites the kubeconfig
        // with namespace-scoped credentials, which would break access to
        // previously imported namespaces on this cluster.
        if (!registeredClusters.has(clusterName)) {
          // Non-managed namespaces lack Azure metadata, so we can't register the cluster
          // on their behalf. The cluster must already be registered.
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

          setImportProgress(
            `${t('Merging cluster {{clusterName}} ({{count}} namespace(s))', {
              clusterName,
              count: namespacesInCluster.length,
            })}...`
          );

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

        // 2b: Apply project labels to namespaces that need conversion.
        // The project-id label is required for Headlamp to recognize the namespace as a project,
        // so we must wait for this to complete before importing.
        const failedNames = new Set<string>();
        for (const ns of namespacesInCluster) {
          if (ns.isAksProject) continue;

          setImportProgress(
            t('Converting {{name}} to AKS project (this may take a moment)...', {
              name: ns.name,
            })
          );
          try {
            // For managed namespaces, fall back to cluster-level Azure metadata
            // (from other managed namespaces on the same cluster) so applyProjectLabels
            // uses the ARM API. For regular namespaces, use their own (empty) metadata
            // so applyProjectLabels uses the K8s API — the ARM API would reject them
            // because they don't exist as managed namespace resources.
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

        // 2c: Update allowed namespaces in localStorage
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
          processedCount++;
          setImportProgress(
            `${t('Importing {{current}} of {{total}}: {{name}} from {{clusterName}}', {
              current: processedCount,
              total: totalCount,
              name: ns.name,
              clusterName,
            })}...`
          );

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
    const successfulClusters = new Set(results.filter(r => r.success).map(r => r.clusterName)).size;

    if (successCount > 0) {
      const clusterText = t('Successfully merged {{count}} cluster(s)', {
        count: successfulClusters,
      });
      const projectText = t('with {{count}} project(s)', { count: successCount });
      const failureSuffix =
        failureCount > 0 ? ` ${t('{{count}} failed.', { count: failureCount })}` : '.';
      setSuccess(`${clusterText} ${projectText}${failureSuffix}`);
    } else if (results.length > 0) {
      setError(t('Failed to import any projects. See details below.'));
    }

    setImporting(false);
    setImportProgress('');
  };

  const displayError = error || (!dismissedDiscoveryError && discoveryError) || '';

  return (
    <>
      <PageGrid>
        <SectionBox title={t('Import AKS Projects')}>
          <Typography variant="body1" sx={{ mb: 3 }}>
            {t(
              'Import existing managed namespaces and regular namespaces as projects. Namespaces that are not yet AKS Desktop projects will be converted by adding the required project label.'
            )}
          </Typography>

          {displayError && (
            <Alert
              severity="error"
              onClose={() => {
                if (error) {
                  setError('');
                } else {
                  setDismissedDiscoveryError(true);
                }
              }}
              sx={{ mb: 2 }}
            >
              {displayError}
            </Alert>
          )}

          {success && (
            <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}

          {!importResults && (
            <>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  mb: 2,
                  gap: 1,
                }}
              >
                <Typography variant="h6">
                  {t('Select Namespaces to Import')}{' '}
                  {t('{{count}} selected', { count: selectedCount })}
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  onClick={refresh}
                  disabled={importing || loadingNamespaces}
                  sx={{ ml: 'auto' }}
                  startIcon={<Icon icon="mdi:refresh" />}
                >
                  {t('Refresh')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  onClick={selectAll}
                  disabled={importing}
                >
                  {t('Select All')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  onClick={deselectAll}
                  disabled={importing}
                >
                  {t('Deselect All')}
                </Button>
              </Box>

              <Table
                enableTopToolbar={false}
                enableRowSelection={false}
                data={namespaces}
                loading={loadingNamespaces}
                columns={[
                  {
                    header: '',
                    accessorFn: (n: ImportSelection) => n.selected,
                    gridTemplate: 'min-content',
                    enableSorting: false,
                    Cell: ({ row: { original: item } }: { row: { original: ImportSelection } }) => (
                      <Checkbox
                        checked={item.selected}
                        onChange={() => toggleSelection(item.namespace)}
                        disabled={importing}
                        size="small"
                        sx={{ padding: '4px' }}
                      />
                    ),
                  },
                  {
                    header: t('Name'),
                    accessorFn: (n: ImportSelection) => n.namespace.name,
                  },
                  {
                    header: t('Type'),
                    accessorFn: (n: ImportSelection) =>
                      n.namespace.isManagedNamespace ? 'AKS Managed' : 'Regular',
                    gridTemplate: 'min-content',
                    Cell: ({ row: { original: item } }: { row: { original: ImportSelection } }) => (
                      <Chip
                        label={item.namespace.isManagedNamespace ? t('AKS Managed') : t('Regular')}
                        color={item.namespace.isManagedNamespace ? 'primary' : 'default'}
                        size="small"
                        variant="outlined"
                      />
                    ),
                  },
                  {
                    header: t('Cluster'),
                    accessorFn: (n: ImportSelection) => n.namespace.clusterName,
                  },
                  {
                    header: t('Resource Group'),
                    accessorFn: (n: ImportSelection) => n.namespace.resourceGroup,
                  },
                  {
                    header: t('AKS Project?'),
                    accessorFn: (n: ImportSelection) => (n.namespace.isAksProject ? 'Yes' : 'No'),
                    gridTemplate: 'min-content',
                    Cell: ({ row: { original: item } }: { row: { original: ImportSelection } }) =>
                      item.namespace.isAksProject ? (
                        <Chip
                          icon={<Icon icon="mdi:check-circle" />}
                          label={t('Yes')}
                          color="success"
                          size="small"
                          variant="outlined"
                        />
                      ) : (
                        <Chip
                          icon={<Icon icon="mdi:close-circle" />}
                          label={t('No')}
                          color="default"
                          size="small"
                          variant="outlined"
                        />
                      ),
                  },
                ]}
              />
              <Box sx={{ display: 'flex', width: '100%', gap: 1 }}>
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={handleCancel}
                  disabled={importing}
                >
                  {t('Cancel')}
                </Button>

                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleImportClick}
                  disabled={selectedCount === 0 || importing}
                  sx={{ ml: 'auto' }}
                  startIcon={
                    importing ? <CircularProgress size={20} /> : <Icon icon="mdi:import" />
                  }
                >
                  {importing
                    ? importProgress || t('Importing') + '...'
                    : t('Import Selected Projects')}
                </Button>
              </Box>
            </>
          )}

          {/* Import Results */}
          {importResults && importResults.length > 0 && (
            <>
              <Box sx={{ mt: 2 }}>
                {importResults.map(result => (
                  <Alert
                    key={`${result.clusterName}/${result.namespace}`}
                    severity={result.success ? 'success' : 'error'}
                    sx={{ mb: 1 }}
                  >
                    <strong>{result.namespace}</strong>: {result.message}
                  </Alert>
                ))}
              </Box>
              <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
                {importResults.some(r => r.success) && (
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => {
                      // Navigate to root and force a full reload because Headlamp's cluster
                      // config is loaded at startup and does not reactively update when
                      // kubeconfig/localStorage changes.
                      window.location.href = '/';
                    }}
                    startIcon={<Icon icon="mdi:folder-open" />}
                  >
                    {t('Go To Projects')}
                  </Button>
                )}
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={handleCancel}
                  disabled={importing}
                >
                  {t('Close')}
                </Button>
              </Box>
            </>
          )}
        </SectionBox>
      </PageGrid>

      <ConversionDialog
        open={showConversionDialog}
        onClose={() => setShowConversionDialog(false)}
        onConfirm={processImport}
        namespacesToConvert={selectedNamespaces
          .filter(s => !s.namespace.isAksProject)
          .map(s => s.namespace)}
        namespacesToImport={selectedNamespaces
          .filter(s => s.namespace.isAksProject)
          .map(s => s.namespace)}
        converting={importing}
      />
    </>
  );
}

export default function ImportAKSProjects() {
  return (
    <AzureAuthGuard>
      <ImportAKSProjectsContent />
    </AzureAuthGuard>
  );
}
