import { Icon } from '@iconify/react';
import { PageGrid, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
// @ts-ignore
import { useClustersConf } from '@kinvolk/headlamp-plugin/lib/K8s';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import { getSubscriptions, registerAKSCluster } from '../../utils/azure/aks';
import {
  getManagedNamespaceDetails,
  getManagedNamespacesForSubscription,
} from '../../utils/azure/az-cli';
import AzureAuthGuard from '../AzureAuth/AzureAuthGuard';
import AzureCliWarning from '../AzureCliWarning';

// Project label constants
const PROJECT_ID_LABEL = 'headlamp.dev/project-id';
const PROJECT_MANAGED_BY_LABEL = 'headlamp.dev/project-managed-by';
const PROJECT_MANAGED_BY_AKS_DESKTOP = 'aks-desktop';

interface Subscription {
  id: string;
  name: string;
  state: string;
}

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

export default function ImportAKSProjects() {
  const history = useHistory();
  const authStatus = useAzureAuth();
  const clustersConf = useClustersConf(); // Get currently merged clusters

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Step 1: Select subscription
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null);

  // Step 2: Discover and select namespaces (auto-discovered from subscription)
  const [namespaces, setNamespaces] = useState<ImportSelection[]>([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState('');

  // Step 3: Import
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importResults, setImportResults] = useState<
    Array<{ namespace: string; success: boolean; message: string }>
  >([]);

  useEffect(() => {
    if (authStatus.isLoggedIn) {
      loadSubscriptions();
    }
  }, [authStatus.isLoggedIn]);

  useEffect(() => {
    if (selectedSubscription) {
      discoverNamespaces();
    } else {
      setNamespaces([]);
    }
  }, [selectedSubscription]);

  const loadSubscriptions = async () => {
    setLoadingSubscriptions(true);
    setError('');

    try {
      const result = await getSubscriptions();

      if (!result.success) {
        setError(result.message);
        return;
      }

      setSubscriptions(result.subscriptions || []);

      if (result.subscriptions && result.subscriptions.length === 1) {
        setSelectedSubscription(result.subscriptions[0]);
      }
    } catch (err) {
      console.error('Error loading subscriptions:', err);
      setError('Failed to load subscriptions');
    } finally {
      setLoadingSubscriptions(false);
    }
  };

  const discoverNamespaces = async () => {
    if (!selectedSubscription) {
      return;
    }

    setLoadingNamespaces(true);
    setError('');
    setNamespaces([]);

    try {
      const mergedClusterNames = Object.values(clustersConf || {}).map((c: any) => c.name);

      const namespacesData = await getManagedNamespacesForSubscription(selectedSubscription.id);

      if (namespacesData.length === 0) {
        setError('No managed namespaces found in this subscription.');
        return;
      }

      const allNamespaces: ImportSelection[] = [];

      // Fetch details for each namespace to check labels
      // Show progress as we check each one
      for (let i = 0; i < namespacesData.length; i++) {
        const ns = namespacesData[i];
        setDiscoveryProgress(
          `Checking namespace ${i + 1} of ${namespacesData.length}: ${ns.name}...`
        );

        try {
          const details = await getManagedNamespaceDetails({
            clusterName: ns.clusterName,
            resourceGroup: ns.resourceGroup,
            namespaceName: ns.name,
            subscriptionId: selectedSubscription.id,
          });

          // Check if namespace has the required project labels
          // Labels are in properties.labels for AKS managed namespaces
          const labels = details?.properties?.labels || {};
          const hasProjectId = labels[PROJECT_ID_LABEL];
          const isManagedByAKSDesktop =
            labels[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_AKS_DESKTOP;
          // Only include namespaces that have both required labels
          if (hasProjectId && isManagedByAKSDesktop) {
            // Check if this cluster is already merged
            const isClusterMerged = mergedClusterNames.includes(ns.clusterName);

            // Only add namespaces from clusters that are NOT merged
            if (!isClusterMerged) {
              const newNamespace = {
                namespace: {
                  name: ns.name,
                  clusterName: ns.clusterName,
                  resourceGroup: ns.resourceGroup,
                  subscriptionId: selectedSubscription.id,
                },
                projectName: labels[PROJECT_ID_LABEL], // Use existing project ID
                selected: true, // Select all by default
                clusterMerged: false,
              };
              allNamespaces.push(newNamespace);
              // Update UI immediately to show found namespaces
              setNamespaces([...allNamespaces]);
            }
          }
        } catch (detailError) {
          console.warn(`Failed to fetch details for namespace ${ns.name}:`, detailError);
          // Skip this namespace if we can't get details
        }
      }

      setDiscoveryProgress('');

      if (allNamespaces.length === 0) {
        setError(
          'No AKS desktop projects found in unmerged clusters. Managed namespaces must have the required project labels.'
        );
      }
    } catch (err) {
      console.error('Error discovering namespaces:', err);
      setError('Failed to discover managed namespaces');
    } finally {
      setLoadingNamespaces(false);
    }
  };

  const handleImport = async () => {
    const selectedNamespaces = namespaces.filter(ns => ns.selected);

    if (selectedNamespaces.length === 0) {
      setError('Please select at least one namespace to import');
      return;
    }

    setImporting(true);
    setError('');
    setSuccess('');
    setImportResults([]);

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
      try {
        const registerResult = await registerAKSCluster(subscriptionId, resourceGroup, clusterName);

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
          <Box sx={{ p: 3 }}>
            <Typography variant="body1" sx={{ mb: 3 }}>
              Import existing AKS managed namespaces as projects. This will discover managed
              namespaces from your AKS clusters and set them up as projects in AKS desktop.
            </Typography>

            {error && (
              <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>
                {success}
              </Alert>
            )}

            {/* Step 1: Select Subscription */}
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  <Icon icon="mdi:numeric-1-circle" style={{ marginRight: 8 }} />
                  Select Subscription
                </Typography>

                <Autocomplete
                  fullWidth
                  options={subscriptions}
                  value={selectedSubscription}
                  onChange={(event, value) => setSelectedSubscription(value)}
                  getOptionLabel={option =>
                    `${option.name}${option.state !== 'Enabled' ? ` (${option.state})` : ''}`
                  }
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  disabled={loadingSubscriptions || importing}
                  loading={loadingSubscriptions}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label="Subscription"
                      placeholder="Select an Azure subscription"
                      InputProps={{
                        ...params.InputProps,
                        endAdornment: (
                          <>
                            {loadingSubscriptions ? (
                              <CircularProgress color="inherit" size={20} />
                            ) : null}
                            {params.InputProps.endAdornment}
                          </>
                        ),
                      }}
                    />
                  )}
                />
              </CardContent>
            </Card>

            {/* Step 2: Loading indicator for namespace discovery */}
            {selectedSubscription && loadingNamespaces && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Box display="flex" flexDirection="column" gap={1}>
                    <Box display="flex" alignItems="center">
                      <CircularProgress size={20} style={{ marginRight: 8 }} />
                      <Typography>
                        {discoveryProgress || 'Discovering managed namespaces from subscription...'}
                      </Typography>
                    </Box>
                    {namespaces.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        Found {namespaces.length} project{namespaces.length !== 1 ? 's' : ''} so
                        far...
                      </Typography>
                    )}
                  </Box>
                </CardContent>
              </Card>
            )}

            {/* Step 2: Select Namespaces to Import */}
            {namespaces.length > 0 && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 2,
                    }}
                  >
                    <Typography variant="h6">
                      <Icon icon="mdi:numeric-2-circle" style={{ marginRight: 8 }} />
                      Select Namespaces to Import ({
                        namespaces.filter(ns => ns.selected).length
                      }{' '}
                      selected)
                    </Typography>
                    <Box>
                      <Button size="small" onClick={selectAll} disabled={importing}>
                        Select All
                      </Button>
                      <Button size="small" onClick={deselectAll} disabled={importing}>
                        Deselect All
                      </Button>
                    </Box>
                  </Box>

                  <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                    {namespaces.map((item, index) => (
                      <Box
                        key={`${item.namespace.clusterName}-${item.namespace.name}`}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 2,
                          p: 1,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={item.selected}
                              onChange={() => toggleNamespaceSelection(index)}
                              disabled={importing}
                            />
                          }
                          label=""
                        />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2">
                            <strong>{item.projectName}</strong>
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            Namespace: {item.namespace.name} • Cluster: {item.namespace.clusterName}{' '}
                            • Resource Group: {item.namespace.resourceGroup}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>

                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleImport}
                    disabled={namespaces.filter(ns => ns.selected).length === 0 || importing}
                    sx={{ mt: 2 }}
                    startIcon={
                      importing ? <CircularProgress size={20} /> : <Icon icon="mdi:import" />
                    }
                  >
                    {importing ? importProgress || 'Importing...' : 'Import Selected Projects'}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Action Buttons */}
            {importResults.length > 0 && (
              <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
                {importResults.some(r => r.success) ? (
                  <>
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
                    <Button variant="outlined" onClick={handleCancel}>
                      Close
                    </Button>
                  </>
                ) : (
                  <Button variant="outlined" onClick={handleCancel}>
                    Close
                  </Button>
                )}
              </Box>
            )}

            {/* Import Results */}
            {importResults.length > 0 && (
              <Card sx={{ mt: 3 }}>
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Import Results
                  </Typography>

                  {importResults.map((result, index) => (
                    <Alert
                      key={index}
                      severity={result.success ? 'success' : 'error'}
                      sx={{ mb: 1 }}
                    >
                      <strong>{result.namespace}:</strong> {result.message}
                    </Alert>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Cancel Button - shown when no import has started */}
            {importResults.length === 0 && (
              <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
                <Button variant="outlined" onClick={handleCancel} disabled={importing}>
                  Cancel
                </Button>
              </Box>
            )}
          </Box>
        </SectionBox>
      </PageGrid>
    </AzureAuthGuard>
  );
}
