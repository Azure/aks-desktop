// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { ClusterConfigurePanel } from '../CreateAKSProject/components/ClusterConfigurePanel';

export interface Subscription {
  id: string;
  name: string;
  state: string;
  tenantId: string;
  tenantName?: string;
}

export interface Tenant {
  id: string;
  name: string;
}

export interface AKSCluster {
  name: string;
  resourceGroup: string;
  location: string;
  kubernetesVersion: string;
  provisioningState: string;
  /** `'aks'` for managed clusters, `'aksarc'` for Arc-connected (AKS Hybrid & Edge) clusters. */
  clusterType?: 'aks' | 'aksarc';
  /** For AKS Hybrid & Edge clusters: Arc agent status (`'Connected'` when online). */
  connectivityStatus?: string;
}

/** AKS Hybrid & Edge cluster is online only when its Arc agent reports 'Connected'. */
export function isAksHybridEdgeOnline(cluster: AKSCluster): boolean {
  return cluster.clusterType !== 'aksarc' || cluster.connectivityStatus === 'Connected';
}

export interface RegisterAKSClusterDialogPureProps {
  open: boolean;
  isChecking: boolean;
  isLoggedIn: boolean;
  loading: boolean;
  loadingSubscriptions: boolean;
  loadingClusters: boolean;
  capabilitiesLoading: boolean;
  error: string;
  success: string;
  subscriptions: Subscription[];
  selectedSubscription: Subscription | null;
  subscriptionInputValue: string;
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  tenantInputValue: string;
  clusters: AKSCluster[];
  filteredClusters: AKSCluster[];
  clusterInputValue: string;
  selectedCluster: AKSCluster | null;
  capabilities: ClusterCapabilities | null;
  onClose: () => void;
  onSubscriptionChange: (event: React.SyntheticEvent, value: Subscription | null) => void;
  onSubscriptionInputChange: (event: React.SyntheticEvent, value: string, reason: string) => void;
  onTenantChange: (event: React.SyntheticEvent, value: Tenant | null) => void;
  onTenantInputChange: (event: React.SyntheticEvent, value: string, reason: string) => void;
  onClusterChange: (event: React.SyntheticEvent, value: AKSCluster | null) => void;
  onClusterInputChange: (event: React.SyntheticEvent, value: string, reason: string) => void;
  onRegister: () => void;
  onDone: () => void;
  onDismissError: () => void;
  onDismissSuccess: () => void;
  onConfigured?: () => void;
}

export default function RegisterAKSClusterDialogPure({
  open,
  isChecking,
  isLoggedIn,
  loading,
  loadingSubscriptions,
  loadingClusters,
  capabilitiesLoading,
  error,
  success,
  subscriptions,
  selectedSubscription,
  subscriptionInputValue,
  tenants,
  selectedTenant,
  tenantInputValue,
  clusters,
  filteredClusters,
  selectedCluster,
  clusterInputValue,
  capabilities,
  onClose,
  onSubscriptionChange,
  onSubscriptionInputChange,
  onTenantChange,
  onTenantInputChange,
  onClusterChange,
  onClusterInputChange,
  onRegister,
  onDone,
  onDismissError,
  onDismissSuccess,
  onConfigured,
}: RegisterAKSClusterDialogPureProps) {
  const { t } = useTranslation();
  const isAksHybridEdgeSelected = selectedCluster?.clusterType === 'aksarc';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="register-aks-dialog-title"
    >
      <DialogTitle id="register-aks-dialog-title" component="h1">
        <Box display="flex" alignItems="center" gap={1}>
          <Icon icon="logos:microsoft-azure" style={{ fontSize: '24px' }} aria-hidden="true" />
          <Typography variant="h6" component="span">
            {t('Register AKS Cluster')}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} pt={1}>
          {error && (
            <Alert severity="error" onClose={onDismissError}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" onClose={onDismissSuccess}>
              {success}
            </Alert>
          )}

          {capabilitiesLoading && (
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={16} aria-hidden="true" />
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
            selectedCluster &&
            clusterInputValue === selectedCluster.name && (
              <ClusterConfigurePanel
                capabilities={capabilities}
                subscriptionId={selectedSubscription.id}
                resourceGroup={selectedCluster.resourceGroup}
                clusterName={selectedCluster.name}
                onConfigured={onConfigured ?? (() => {})}
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

          {isChecking && (
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={20} aria-hidden="true" />
              <Typography variant="body2" color="textSecondary">
                {t('Checking authentication status')}...
              </Typography>
            </Box>
          )}

          {!isChecking && !isLoggedIn && (
            <Alert severity="warning">
              {t('You need to be logged in to Azure to register AKS clusters.')}
            </Alert>
          )}

          {!isChecking && isLoggedIn && (
            <>
              <Autocomplete
                fullWidth
                options={tenants}
                value={selectedTenant}
                onChange={onTenantChange}
                inputValue={tenantInputValue}
                onInputChange={onTenantInputChange}
                getOptionKey={option => option.id}
                getOptionLabel={option => option.name}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                disabled={loadingSubscriptions || tenants.length <= 1}
                renderInput={params => (
                  <TextField
                    {...params}
                    label={t('Tenant')}
                    placeholder={t('Select an Azure tenant')}
                  />
                )}
                renderOption={(props, option) => (
                  <li {...props} key={option.id}>
                    <Box>
                      <Typography variant="body1">{option.name}</Typography>
                      <Typography variant="caption" color="textSecondary">
                        {option.id}
                      </Typography>
                    </Box>
                  </li>
                )}
              />

              <Autocomplete
                fullWidth
                options={subscriptions}
                value={selectedSubscription}
                onChange={onSubscriptionChange}
                inputValue={subscriptionInputValue}
                onInputChange={onSubscriptionInputChange}
                filterOptions={x => x}
                getOptionKey={option => option.id}
                getOptionLabel={option =>
                  `${option.name}${option.state !== 'Enabled' ? ` (${option.state})` : ''}`
                }
                isOptionEqualToValue={(option, value) => option.id === value.id}
                disabled={loadingSubscriptions || (tenants.length > 1 && !selectedTenant)}
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
                            <CircularProgress color="inherit" size={20} aria-hidden="true" />
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
                  <CircularProgress size={20} aria-hidden="true" />
                  <Typography variant="body2" color="textSecondary">
                    {t('Loading subscriptions')}...
                  </Typography>
                </Box>
              )}

              {loadingClusters && (
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={20} aria-hidden="true" />
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
                  options={filteredClusters}
                  value={selectedCluster}
                  onChange={onClusterChange}
                  inputValue={clusterInputValue}
                  onInputChange={onClusterInputChange}
                  filterOptions={x => x}
                  getOptionKey={option => `${option.resourceGroup}/${option.name}`}
                  getOptionLabel={option => option.name}
                  getOptionDisabled={option => !isAksHybridEdgeOnline(option)}
                  isOptionEqualToValue={(option, value) =>
                    option.name === value.name && option.resourceGroup === value.resourceGroup
                  }
                  renderInput={params => (
                    <TextField
                      {...params}
                      label={t('AKS Cluster')}
                      placeholder={t('Select an AKS cluster')}
                    />
                  )}
                  renderOption={(props, option) => {
                    const offline = !isAksHybridEdgeOnline(option);
                    return (
                      <li {...props} key={`${option.resourceGroup}/${option.name}`}>
                        <Box width="100%">
                          <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="body1">{option.name}</Typography>
                            {option.clusterType === 'aksarc' && (
                              <Chip
                                label={t('AKS Hybrid & Edge')}
                                size="small"
                                color="info"
                                variant="outlined"
                                icon={<Icon icon="mdi:server" aria-hidden="true" />}
                              />
                            )}
                            {offline && (
                              <Chip
                                label={t('Offline')}
                                size="small"
                                color="default"
                                variant="outlined"
                                icon={<Icon icon="mdi:cloud-off-outline" aria-hidden="true" />}
                              />
                            )}
                          </Box>
                          <Typography variant="caption" color="textSecondary">
                            {option.location} • v{option.kubernetesVersion} •{' '}
                            {offline ? option.connectivityStatus : option.provisioningState}
                          </Typography>
                        </Box>
                      </li>
                    );
                  }}
                />
              )}

              {selectedCluster && clusterInputValue === selectedCluster.name && !success && (
                <Box
                  p={2}
                  bgcolor="action.hover"
                  borderRadius={1}
                  role="region"
                  aria-label={t('Selected Cluster Details')}
                >
                  <Typography variant="subtitle2" component="p" gutterBottom>
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
                  {isAksHybridEdgeSelected && (
                    <Typography variant="body2">
                      <strong>{t('Type')}:</strong> {t('AKS Hybrid & Edge (Arc-connected)')}
                    </Typography>
                  )}
                </Box>
              )}
            </>
          )}
          {/* Persistent live region for loading status announcements.
              Stays in the DOM at all times so screen readers register the region
              before content changes. */}
          <Box
            role="status"
            aria-live="polite"
            aria-atomic="true"
            sx={{
              position: 'absolute',
              width: '1px',
              height: '1px',
              padding: 0,
              margin: '-1px',
              overflow: 'hidden',
              clip: 'rect(0, 0, 0, 0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            {isChecking
              ? `${t('Checking authentication status')}...`
              : loadingSubscriptions
              ? `${t('Loading subscriptions')}...`
              : loadingClusters
              ? `${t('Loading AKS clusters')}...`
              : capabilitiesLoading
              ? 'Checking cluster capabilities...'
              : ''}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        {success ? (
          <Button onClick={onDone} variant="contained">
            {t('Done')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={loading}>
              {t('Cancel')}
            </Button>
            <Button
              onClick={onRegister}
              variant="contained"
              color="primary"
              disabled={!selectedCluster || loading || !isLoggedIn || isChecking}
              startIcon={
                loading ? (
                  <CircularProgress size={20} aria-hidden="true" />
                ) : (
                  <Icon icon="mdi:cloud-check" aria-hidden="true" />
                )
              }
              aria-busy={loading || undefined}
            >
              {loading ? `${t('Registering')}...` : t('Register Cluster')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
