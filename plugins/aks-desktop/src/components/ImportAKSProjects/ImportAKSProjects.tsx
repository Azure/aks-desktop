import { Icon } from '@iconify/react';
import { PageGrid, SectionBox, Table } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
// @ts-ignore
import { Alert, Box, Button, Checkbox, CircularProgress, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { registerAKSCluster } from '../../utils/azure/aks';
import { runCommandAsync } from '../../utils/azure/az-cli';
import AzureAuthGuard from '../AzureAuth/AzureAuthGuard';
import AzureCliWarning from '../AzureCliWarning';

// Project label constants
const PROJECT_MANAGED_BY_LABEL = 'headlamp.dev/project-managed-by';
const PROJECT_MANAGED_BY_AKS_DESKTOP = 'aks-desktop';

interface ManagedNamespace {
  name: string;
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
}

interface ImportSelection {
  namespace: ManagedNamespace;
  projectName: string;
  selected: boolean;
  clusterMerged: boolean; // Track if cluster is already in kubeconfig
}

function ImportAKSProjectsContent() {
  const history = useHistory();

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Step 2: Discover and select namespaces (auto-discovered from subscription)
  const [namespaces, setNamespaces] = useState<ImportSelection[]>([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);

  // Step 3: Import
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importResults, setImportResults] = useState<
    Array<{ namespace: string; success: boolean; message: string }> | undefined
  >();

  useEffect(() => {
    const loadNamespaces = async () => {
      const query = `resources | where type =~ 'microsoft.containerservice/managedclusters/managednamespaces' | where properties['labels']['${PROJECT_MANAGED_BY_LABEL}'] == '${PROJECT_MANAGED_BY_AKS_DESKTOP}'`;

      const { stdout, stderr } = await runCommandAsync('az', [
        'graph',
        'query',
        '-q',
        (window as any).desktopApi.platform === 'win32' ? `"${query}"` : query,
        '--output',
        'json',
      ]);

      if (stderr) throw new Error(stderr);

      const namespaces = JSON.parse(stdout).data;

      const selections = namespaces.map(n => {
        function getClusterName(str) {
          const m = str.match(/managedClusters\/([^/]+)/);
          return m ? m[1] : '';
        }

        const ns: ImportSelection = {
          projectName: n.properties.labels['headlamp.dev/project-id'],
          clusterMerged: false,
          namespace: {
            name: n.name,
            clusterName: getClusterName(n.id),
            resourceGroup: n.resourceGroup,
            subscriptionId: n.subscriptionId,
          },
          selected: true,
        };
        return ns;
      });

      setNamespaces(selections);
    };

    setLoadingNamespaces(true);
    loadNamespaces()
      .catch(e => {
        console.error(e);
        setError(e.message);
      })
      .finally(() => {
        setLoadingNamespaces(false);
      });
  }, []);

  const handleImport = async () => {
    const selectedNamespaces = namespaces.filter(ns => ns.selected);

    if (selectedNamespaces.length === 0) {
      setError('Please select at least one namespace to import');
      return;
    }

    setImporting(true);
    setError('');
    setSuccess('');
    setImportResults(undefined);

    const results: Array<{ namespace: string; success: boolean; message: string }> = [];

    // Group namespaces by cluster to merge each cluster only once
    const clusterMap = new Map<
      string,
      Array<{ namespace: ManagedNamespace; projectName: string }>
    >();

    for (const item of selectedNamespaces) {
      const { namespace } = item;
      const clusterKey = `${namespace.clusterName}|${namespace.resourceGroup}|${namespace.subscriptionId}`;

      if (!clusterMap.has(clusterKey)) {
        clusterMap.set(clusterKey, []);
      }
      clusterMap.get(clusterKey)!.push(item);
    }

    // Process each cluster and its namespaces
    let processedCount = 0;
    for (const [clusterKey, namespacesInCluster] of clusterMap) {
      const [clusterName, resourceGroup, subscriptionId] = clusterKey.split('|');

      setImportProgress(
        `Merging cluster ${clusterName} (${namespacesInCluster.length} namespace${
          namespacesInCluster.length > 1 ? 's' : ''
        })...`
      );

      // Step 1: Merge/register the cluster ONCE per unique cluster
      // If it's a managed namespace, use namespace-scoped credentials
      try {
        const firstNamespaceInfo = namespacesInCluster[0].namespace;
        const managedNamespace = firstNamespaceInfo.name;

        const registerResult = await registerAKSCluster(
          subscriptionId,
          resourceGroup,
          clusterName,
          managedNamespace
        );

        if (!registerResult.success) {
          // If cluster merge fails, mark all namespaces from this cluster as failed
          for (const { namespace } of namespacesInCluster) {
            results.push({
              namespace: `${namespace.name} (${clusterName})`,
              success: false,
              message: `Failed to merge cluster: ${registerResult.message}`,
            });
          }
          continue;
        }

        // add allowed namespaces
        const settings = JSON.parse(
          localStorage.getItem(`cluster_settings.${clusterName}`) || '{}'
        );
        settings.allowedNamespaces ??= [];
        settings.allowedNamespaces.push(...namespacesInCluster.map(it => it.namespace.name));
        settings.allowedNamespaces = [...new Set(settings.allowedNamespaces)];
        localStorage.setItem(`cluster_settings.${clusterName}`, JSON.stringify(settings));

        // Step 2: Mark all namespaces in this cluster as successfully imported
        // No need to patch labels - they already exist from AKS managed namespace
        for (const { namespace, projectName } of namespacesInCluster) {
          processedCount++;
          setImportProgress(
            `Importing ${processedCount} of ${selectedNamespaces.length}: ${namespace.name} from ${clusterName}...`
          );

          results.push({
            namespace: `${namespace.name} (${clusterName})`,
            success: true,
            message: `Project '${projectName}' successfully imported from namespace '${namespace.name}'`,
          });
        }
      } catch (err) {
        // Mark all namespaces from this cluster as failed
        for (const { namespace } of namespacesInCluster) {
          results.push({
            namespace: `${namespace.name} (${clusterName})`,
            success: false,
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    setImportResults(results);

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    const successfulClusters = new Set(
      results.filter(r => r.success).map(r => r.namespace.split('(')[1]?.replace(')', '').trim())
    ).size;

    if (successCount > 0) {
      setSuccess(
        `Successfully merged ${successfulClusters} cluster${
          successfulClusters > 1 ? 's' : ''
        } with ${successCount} project${successCount > 1 ? 's' : ''}` +
          (failureCount > 0
            ? `. ${failureCount} project${failureCount > 1 ? 's' : ''} failed.`
            : '.')
      );
    } else {
      setError('Failed to import any projects. See details below.');
    }

    setImporting(false);
    setImportProgress('');
  };

  const toggleNamespaceSelection = (index: number) => {
    setNamespaces(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], selected: !updated[index].selected };
      return updated;
    });
  };

  const selectAll = () => {
    setNamespaces(prev => prev.map(ns => ({ ...ns, selected: true })));
  };

  const deselectAll = () => {
    setNamespaces(prev => prev.map(ns => ({ ...ns, selected: false })));
  };

  const handleCancel = () => {
    history.push('/');
  };

  return (
    <AzureAuthGuard>
      <AzureCliWarning suggestions={[]} />
      <PageGrid>
        <SectionBox title="Import AKS Projects">
          <Typography variant="body1" sx={{ mb: 3 }}>
            Import existing AKS Projects that you have access to.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
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
                  Select Namespaces to Import ({namespaces.filter(ns => ns.selected).length}{' '}
                  selected)
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  onClick={selectAll}
                  disabled={importing}
                  sx={{ ml: 'auto' }}
                  icon={<Icon icon="mdi:select-all" />}
                >
                  Select All
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  onClick={deselectAll}
                  disabled={importing}
                >
                  Deselect All
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
                    accessorFn: n => n.selected,
                    gridTemplate: 'min-content',
                    enableSorting: false,
                    Cell: ({ row: { original: item, index } }) => (
                      <Checkbox
                        checked={item.selected}
                        onChange={() => toggleNamespaceSelection(index)}
                        disabled={importing}
                        size="small"
                        sx={{ padding: '4px' }}
                      />
                    ),
                  },
                  {
                    header: 'Project Name',
                    accessorFn: n => n.projectName,
                  },
                  {
                    header: 'Namespace',
                    accessorFn: n => n.namespace.name,
                  },
                  {
                    header: 'Cluster',
                    accessorFn: n => n.namespace.clusterName,
                  },
                  {
                    header: 'Resource Group',
                    accessorFn: n => n.namespace.resourceGroup,
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
                  Cancel
                </Button>

                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleImport}
                  disabled={namespaces.filter(ns => ns.selected).length === 0 || importing}
                  sx={{ ml: 'auto' }}
                  startIcon={
                    importing ? <CircularProgress size={20} /> : <Icon icon="mdi:import" />
                  }
                >
                  {importing ? importProgress || 'Importing...' : 'Import Selected Projects'}
                </Button>
              </Box>
            </>
          )}

          {/* Action Buttons */}
          {importResults?.length > 0 && (
            <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
              {importResults.some(r => r.success) && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => {
                    history.replace('/');
                    window.location.reload();
                  }}
                  startIcon={<Icon icon="mdi:folder-open" />}
                >
                  Go To Projects
                </Button>
              )}
              <Button
                variant="contained"
                color="secondary"
                onClick={handleCancel}
                disabled={importing}
              >
                Close
              </Button>
            </Box>
          )}
        </SectionBox>
      </PageGrid>
    </AzureAuthGuard>
  );
}

export default function ImportAKSProjects() {
  return (
    <AzureAuthGuard>
      <ImportAKSProjectsContent />
    </AzureAuthGuard>
  );
}
