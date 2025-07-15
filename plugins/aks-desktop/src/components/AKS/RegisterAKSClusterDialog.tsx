// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
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
import { useAzureAuth } from '../../hooks/useAzureAuth';
import { getAKSClusters, getSubscriptions, registerAKSCluster } from '../../utils/azure/aks';

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
      setError('Failed to load subscriptions');
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
      setError('Failed to load AKS clusters');
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
      console.log('[AKS] Registering cluster...');
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

      console.log('[AKS] Cluster registered successfully:', result.message);
      setLoading(false);

      // Show success message with cluster name
      setSuccess(`Cluster '${selectedCluster.name}' successfully merged in kubeconfig`);

      onClusterRegistered?.();

      // Reload to show new cluster after a delay to allow user to see the success message
      setTimeout(() => {
        console.log('[AKS] Reloading to show new cluster...');
        onClose();
        window.location.reload();
      }, 2000);
    } catch (err) {
      console.error('Error registering AKS cluster:', err);
      setError(
        `Failed to register cluster: ${err instanceof Error ? err.message : 'Unknown error'}`
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
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Icon icon="logos:microsoft-azure" style={{ fontSize: '24px' }} />
          <Typography variant="h6">Register AKS Cluster</Typography>
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

          {!authStatus.isLoggedIn && (
            <Alert severity="warning">
              You need to be logged in to Azure to register AKS clusters.
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
                    Loading subscriptions...
                  </Typography>
                </Box>
              )}

              {loadingClusters && (
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" color="textSecondary">
                    Loading AKS clusters...
                  </Typography>
                </Box>
              )}

              {!loadingClusters && selectedSubscription && clusters.length === 0 && (
                <Alert severity="info">No AKS clusters found in this subscription.</Alert>
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
                      label="AKS Cluster"
                      placeholder="Select an AKS cluster"
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
                    Selected Cluster Details
                  </Typography>
                  <Typography variant="body2">
                    <strong>Name:</strong> {selectedCluster.name}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Resource Group:</strong> {selectedCluster.resourceGroup}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Location:</strong> {selectedCluster.location}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Kubernetes Version:</strong> {selectedCluster.kubernetesVersion}
                  </Typography>
                </Box>
              )}
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        {!success && (
          <Button
            onClick={handleRegister}
            variant="contained"
            color="primary"
            disabled={!selectedCluster || loading || !authStatus.isLoggedIn}
            startIcon={loading ? <CircularProgress size={20} /> : <Icon icon="mdi:cloud-check" />}
          >
            {loading ? 'Registering...' : 'Register Cluster'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
