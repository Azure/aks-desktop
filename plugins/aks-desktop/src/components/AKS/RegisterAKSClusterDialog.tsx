// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { getAKSClusters, getSubscriptions, registerAKSCluster } from '../../utils/azure/aks';
import { getClusterCapabilities } from '../../utils/azure/az-cli';
import { ClusterConfigurePanel } from '../CreateAKSProject/components/ClusterConfigurePanel';

interface RegisterAKSClusterDialogProps {
  open: boolean;
  onClose: () => void;
  onClusterRegistered?: () => void;
}

interface Subscription {
  id: string;
  name: string;
  state: string;
}

interface AKSCluster {
  name: string;
  resourceGroup: string;
  location: string;
  kubernetesVersion: string;
  provisioningState: string;
}

export default function RegisterAKSClusterDialog({
  open,
  onClose,
  onClusterRegistered,
}: RegisterAKSClusterDialogProps) {
  const history = useHistory();
  const { t } = useTranslation();
  const authStatus = useAzureAuth();
  const [loading, setLoading] = useState(false);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null);
  const [clusters, setClusters] = useState<AKSCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<AKSCluster | null>(null);
  const [capabilities, setCapabilities] = useState<ClusterCapabilities | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);

  useEffect(() => {
    if (open && authStatus.isLoggedIn) {
      loadSubscriptions();
    }
  }, [open, authStatus.isLoggedIn]);

  useEffect(() => {
    if (selectedSubscription) {
      loadClusters(selectedSubscription.id);
    } else {
      setClusters([]);
      setSelectedCluster(null);
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

      // Auto-select if only one subscription
      if (result.subscriptions && result.subscriptions.length === 1) {
        setSelectedSubscription(result.subscriptions[0]);
      }
    } catch (err) {
      console.error('Error loading subscriptions:', err);
      setError(t('Failed to load subscriptions'));
    } finally {
      setLoadingSubscriptions(false);
    }
  };

  const loadClusters = async (subscriptionId: string) => {
    setLoadingClusters(true);
    setError('');
    setClusters([]);
    setSelectedCluster(null);

    try {
      const result = await getAKSClusters(subscriptionId);

      if (!result.success) {
        setError(result.message);
        return;
      }

      setClusters(result.clusters || []);
    } catch (err) {
      console.error('Error loading AKS clusters:', err);
      setError(t('Failed to load AKS clusters'));
    } finally {
      setLoadingClusters(false);
    }
  };

  const handleSubscriptionChange = (event: React.SyntheticEvent, value: Subscription | null) => {
    setSelectedSubscription(value);
  };

  const handleClusterChange = (event: React.SyntheticEvent, value: AKSCluster | null) => {
    setSelectedCluster(value);
  };

  const handleRegister = async () => {
    if (!selectedCluster || !selectedSubscription) {
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Register the cluster by running az aks get-credentials and setting up kubeconfig
      const result = await registerAKSCluster(
        selectedSubscription.id,
        selectedCluster.resourceGroup,
        selectedCluster.name
      );

      if (!result.success) {
        setError(result.message);
        setLoading(false);
        return;
      }

      setLoading(false);

      // Show success message with cluster name
      setSuccess(
        t("Cluster '{{cluster}}' successfully merged in kubeconfig", {
          cluster: selectedCluster.name,
        })
      );

      onClusterRegistered?.();

      // Check cluster capabilities (non-blocking)
      setCapabilitiesLoading(true);
      try {
        const caps = await getClusterCapabilities({
          subscriptionId: selectedSubscription.id,
          resourceGroup: selectedCluster.resourceGroup,
          clusterName: selectedCluster.name,
        });
        setCapabilities(caps);
      } catch {
        // Non-critical — just don't show capabilities
      } finally {
        setCapabilitiesLoading(false);
      }
    } catch (err) {
      console.error('Error registering AKS cluster:', err);
      setError(
        t('Failed to register cluster: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle component="h1">
        <Box display="flex" alignItems="center" gap={1}>
          <Icon icon="logos:microsoft-azure" style={{ fontSize: '24px' }} />
          <Typography variant="h6" component="span">
            {t('Register AKS Cluster')}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} pt={1}>
          {error && (
            <Alert severity="error" onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" onClose={() => setSuccess('')}>
              {success}
            </Alert>
          )}

          {capabilitiesLoading && (
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="textSecondary">
                Checking cluster capabilities...
              </Typography>
            </Box>
          )}

          {capabilities && capabilities.azureRbacEnabled !== true && (
            <Alert severity="error" sx={{ mb: 1 }}>
              Azure RBAC for Kubernetes is not enabled. Project role assignments (Admin, Writer,
              Reader) will not work. This must be set at cluster creation.
            </Alert>
          )}

          {capabilities &&
            (!capabilities.networkPolicy || capabilities.networkPolicy === 'none') && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                No network policy engine configured. Network policies will not be enforced. This
                must be set at cluster creation.
              </Alert>
            )}

          {capabilities &&
            (capabilities.prometheusEnabled !== true ||
              capabilities.kedaEnabled !== true ||
              capabilities.vpaEnabled !== true) &&
            selectedSubscription &&
            selectedCluster && (
              <ClusterConfigurePanel
                capabilities={capabilities}
                subscriptionId={selectedSubscription.id}
                resourceGroup={selectedCluster.resourceGroup}
                clusterName={selectedCluster.name}
                onConfigured={() => {
                  if (selectedSubscription && selectedCluster) {
                    getClusterCapabilities({
                      subscriptionId: selectedSubscription.id,
                      resourceGroup: selectedCluster.resourceGroup,
                      clusterName: selectedCluster.name,
                    })
                      .then(caps => setCapabilities(caps))
                      .catch(() => {});
                  }
                }}
              />
            )}

          {capabilities &&
            capabilities.azureRbacEnabled === true &&
            capabilities.prometheusEnabled === true &&
            capabilities.kedaEnabled === true &&
            capabilities.vpaEnabled === true &&
            capabilities.networkPolicy &&
            capabilities.networkPolicy !== 'none' && (
              <Alert severity="success">All recommended cluster configurations are in place.</Alert>
            )}

          {!authStatus.isLoggedIn && (
            <Alert severity="warning">
              {t('You need to be logged in to Azure to register AKS clusters.')}
            </Alert>
          )}

          {authStatus.isLoggedIn && (
            <>
              <Autocomplete
                fullWidth
                options={subscriptions}
                value={selectedSubscription}
                onChange={handleSubscriptionChange}
                getOptionLabel={option =>
                  `${option.name}${option.state !== 'Enabled' ? ` (${option.state})` : ''}`
                }
                isOptionEqualToValue={(option, value) => option.id === value.id}
                disabled={loadingSubscriptions}
                loading={loadingSubscriptions}
                renderInput={params => (
                  <TextField
                    {...params}
                    label={t('Subscription')}
                    placeholder={t('Select an Azure subscription')}
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
                renderOption={(props, option) => (
                  <li {...props} key={option.id}>
                    <Box>
                      <Typography variant="body1">{option.name}</Typography>
                      {option.state !== 'Enabled' && (
                        <Typography variant="caption" color="textSecondary">
                          {option.state}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
              />

              {loadingSubscriptions && (
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" color="textSecondary">
                    {t('Loading subscriptions')}...
                  </Typography>
                </Box>
              )}

              {loadingClusters && (
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" color="textSecondary">
                    {t('Loading AKS clusters')}...
                  </Typography>
                </Box>
              )}

              {!loadingClusters && selectedSubscription && clusters.length === 0 && (
                <Alert severity="info">{t('No AKS clusters found in this subscription.')}</Alert>
              )}

              {!loadingClusters && selectedSubscription && clusters.length > 0 && (
                <Autocomplete
                  fullWidth
                  options={clusters}
                  value={selectedCluster}
                  onChange={handleClusterChange}
                  getOptionLabel={option => option.name}
                  isOptionEqualToValue={(option, value) => option.name === value.name}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label={t('AKS Cluster')}
                      placeholder={t('Select an AKS cluster')}
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props} key={option.name}>
                      <Box width="100%">
                        <Typography variant="body1">{option.name}</Typography>
                        <Typography variant="caption" color="textSecondary">
                          {option.location} • v{option.kubernetesVersion} •{' '}
                          {option.provisioningState}
                        </Typography>
                      </Box>
                    </li>
                  )}
                />
              )}

              {selectedCluster && !success && (
                <Box p={2} bgcolor="action.hover" borderRadius={1}>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('Selected Cluster Details')}
                  </Typography>
                  <Typography variant="body2">
                    <strong>{t('Name')}:</strong> {selectedCluster.name}
                  </Typography>
                  <Typography variant="body2">
                    <strong>{t('Resource Group')}:</strong> {selectedCluster.resourceGroup}
                  </Typography>
                  <Typography variant="body2">
                    <strong>{t('Location')}:</strong> {selectedCluster.location}
                  </Typography>
                  <Typography variant="body2">
                    <strong>{t('Kubernetes Version')}:</strong> {selectedCluster.kubernetesVersion}
                  </Typography>
                </Box>
              )}
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        {success ? (
          <Button
            onClick={() => {
              onClose();
              history.replace('/');
              window.location.reload();
            }}
            variant="contained"
          >
            {t('Done')}
          </Button>
        ) : (
          <>
            <Button onClick={handleClose} disabled={loading}>
              {t('Cancel')}
            </Button>
            <Button
              onClick={handleRegister}
              variant="contained"
              color="primary"
              disabled={!selectedCluster || loading || !authStatus.isLoggedIn}
              startIcon={loading ? <CircularProgress size={20} /> : <Icon icon="mdi:cloud-check" />}
            >
              {loading ? `${t('Registering')}...` : t('Register Cluster')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
