// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
// @ts-ignore
import { useClustersConf } from '@kinvolk/headlamp-plugin/lib/K8s';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  FormControl,
  IconButton,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useAzureAuth } from '../../../hooks/useAzureAuth';
import { registerAKSCluster } from '../../../utils/azure/aks';
import type { BasicsStepProps } from '../types';
import { FormField } from './FormField';
import { SearchableSelect, SearchableSelectOption } from './SearchableSelect';
import { ValidationAlert } from './ValidationAlert';

/**
 * Basics step component for project details and Azure resource selection
 */
export const BasicsStep: React.FC<BasicsStepProps> = ({
  formData,
  onFormDataChange,
  validation,
  loading = false,
  error = null,
  subscriptions,
  clusters,
  loadingClusters,
  clusterError,
  extensionStatus,
  featureStatus,
  namespaceStatus,
  onInstallExtension,
  onRegisterFeature,
  onRetrySubscriptions,
  onRetryClusters,
}) => {
  const { t } = useTranslation();
  const headlampClusters = useClustersConf();
  const authStatus = useAzureAuth();

  // Auto select default subscription
  const autoSelected = useRef(false);
  useEffect(() => {
    if (
      autoSelected.current === false &&
      authStatus?.subscriptionId &&
      !formData.subscription &&
      subscriptions &&
      subscriptions.find(it => it.id === authStatus.subscriptionId)
    ) {
      autoSelected.current = true;
      onFormDataChange({ subscription: authStatus.subscriptionId });
    }
  }, [formData.subscription, authStatus?.subscriptionId, subscriptions]);

  const handleInputChange = (field: string, value: any) => {
    onFormDataChange({ [field]: value });
  };

  const handleClusterChange = (clusterName: string) => {
    const selectedCluster = clusters.find(c => c.name === clusterName);
    if (selectedCluster) {
      onFormDataChange({
        cluster: clusterName,
        resourceGroup: selectedCluster.resourceGroup,
      });
    }
  };

  // helper to check for readiness
  const isClusterNonReady = (cluster: any): boolean => {
    const provisioningState = cluster.status?.toLowerCase() || '';
    const powerState = cluster.powerState?.toLowerCase() || '';

    const nonReadyProvisioningStates = ['updating', 'upgrading', 'deleting', 'creating', 'failed'];
    const nonReadyPowerStates = ['stopping', 'stopped', 'deallocating', 'deallocated'];

    return (
      nonReadyProvisioningStates.includes(provisioningState) ||
      nonReadyPowerStates.includes(powerState)
    );
  };

  // helper function to get cluster state message
  const getClusterStateMessage = (cluster: any): string => {
    const provisioningState = cluster.status?.toLowerCase() || '';
    const powerState = cluster.powerState?.toLowerCase() || '';

    if (provisioningState === 'updating' || provisioningState === 'upgrading') {
      return t('Cluster is currently updating. Deployment may fail.');
    }
    if (provisioningState === 'deleting') {
      return t('Cluster is being deleted. Cannot deploy to this cluster.');
    }
    if (provisioningState === 'creating') {
      return t('Cluster is still being created. Please wait until creation completes.');
    }
    if (provisioningState === 'failed') {
      return t('Cluster is in a failed state. Please check Azure portal.');
    }
    if (powerState === 'stopped' || powerState === 'stopping') {
      return t('Cluster is stopped. Please start the cluster before deploying.');
    }
    if (powerState === 'deallocated' || powerState === 'deallocating') {
      return t('Cluster is deallocated. Please start the cluster before deploying.');
    }
    return '';
  };

  // Convert subscriptions to SearchableSelectOption format
  const subscriptionOptions: SearchableSelectOption[] = subscriptions.map(sub => ({
    value: sub.id,
    label: sub.name,
    subtitle: t('Tenant: {{tenantName}} - ({{tenant}}) • Status: {{status}}', {
      tenantName: sub.tenantName,
      tenant: sub.tenant,
      status: sub.status,
    }),
  }));

  // Convert clusters to SearchableSelectOption format
  const clusterOptions: SearchableSelectOption[] = clusters.map(cluster => ({
    value: cluster.name,
    label: cluster.name,
    subtitle: t('{{location}} • {{version}} • {{nodeCount}} nodes • {{status}}', {
      location: cluster.location,
      version: cluster.version,
      nodeCount: cluster.nodeCount,
      status: cluster.status,
    }),
  }));

  const selectedCluster =
    formData.cluster && clusters.find(cluster => cluster.name === formData.cluster);

  const isClusterMissing =
    selectedCluster &&
    Object.values(headlampClusters).find((it: any) => it.name === selectedCluster.name) ===
      undefined;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {error && (
        <ValidationAlert
          type="error"
          message={error}
          onClose={() => {}} // Will be handled by parent
        />
      )}
      {/* AKS Preview Extension Check */}
      {extensionStatus.installed === false && (
        <ValidationAlert
          type="warning"
          message={
            <Box>
              <Typography variant="body2">
                <strong>{t('AKS Preview Extension Required:')}</strong>{' '}
                {t(
                  'The aks-preview extension is required to create managed namespaces. Please install it to continue.'
                )}
              </Typography>
              {extensionStatus.error && (
                <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
                  {extensionStatus.error}
                </Typography>
              )}
            </Box>
          }
          action={
            <Button
              color="inherit"
              size="small"
              onClick={onInstallExtension}
              disabled={extensionStatus.installing}
            >
              {extensionStatus.installing ? (
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={16} color="inherit" />
                  {t('Installing...')}
                </Box>
              ) : (
                t('Install Extension')
              )}
            </Button>
          }
        />
      )}
      {extensionStatus.showSuccess && (
        <ValidationAlert
          type="success"
          message={t('✓ AKS Preview Extension installed successfully!')}
        />
      )}
      {/* ManagedNamespacePreview Feature Check */}
      {featureStatus.registered === false && (
        <ValidationAlert
          type="error"
          message={
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="h6">Feature Flag Required</Typography>
              <Typography variant="body2">
                {t(
                  'The ManagedNamespacePreview feature must be registered to create managed namespaces.'
                )}
              </Typography>
              {featureStatus.state && (
                <Typography variant="body2">
                  {t('Current state:')} <strong>{featureStatus.state}</strong>
                </Typography>
              )}
              <Typography variant="body2">{t('Please register it to continue.')}</Typography>
              {featureStatus.error && (
                <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                  {featureStatus.error}
                </Typography>
              )}

              <Button
                variant="contained"
                onClick={onRegisterFeature}
                disabled={featureStatus.registering}
                sx={{ alignSelf: 'flex-start' }}
                size="large"
              >
                {featureStatus.registering ? (
                  <Box display="flex" alignItems="center" gap={1}>
                    <CircularProgress size={16} color="inherit" />
                    {t('Registering...')}
                  </Box>
                ) : (
                  t('Register ManagedNamespacePreview Feature')
                )}
              </Button>
            </Box>
          }
        />
      )}
      {featureStatus.showSuccess && (
        <ValidationAlert
          type="success"
          message={t('✓ ManagedNamespacePreview feature registered successfully!')}
        />
      )}
      <Box sx={{ display: 'flex', gap: 3, flexDirection: 'column' }}>
        {/* Project Name */}
        <FormControl fullWidth variant="outlined">
          <FormField
            label={t('Project Name')}
            value={formData.projectName}
            onChange={value => handleInputChange('projectName', value)}
            error={
              namespaceStatus.exists === true ||
              (validation.fieldErrors?.projectName && validation.fieldErrors.projectName.length > 0)
            }
            helperText={
              namespaceStatus.checking
                ? t('Checking if another project exists with same name...')
                : namespaceStatus.exists === true
                ? t(
                    'Another project already exists with same name. Please choose a different name.'
                  )
                : validation.fieldErrors?.projectName &&
                  validation.fieldErrors.projectName.length > 0
                ? validation.fieldErrors.projectName[0]
                : namespaceStatus.exists === false
                ? t('Project name is available')
                : t(
                    'Project name must contain only lowercase letters, numbers, and hyphens (no spaces)'
                  )
            }
            endAdornment={
              <IconButton size="small" sx={{ color: 'primary.main' }}>
                <Icon icon="mdi:edit" />
              </IconButton>
            }
          />
        </FormControl>

        {/* Project Description */}
        <FormControl fullWidth variant="outlined">
          <FormField
            label={t('Project Description')}
            value={formData.description}
            onChange={value => handleInputChange('description', value)}
            type="textarea"
            multiline
            rows={3}
            placeholder={t('Enter project description...')}
          />
        </FormControl>

        {/* Subscription */}
        <SearchableSelect
          label={t('Subscription')}
          value={formData.subscription}
          onChange={value => handleInputChange('subscription', value)}
          options={subscriptionOptions}
          loading={loading}
          error={!!error}
          disabled={loading}
          placeholder={t('Select a subscription...')}
          searchPlaceholder={t('Search subscriptions...')}
          noResultsText={t('No subscriptions found')}
          showSearch
        />
        {error && (
          <Box mt={1}>
            <ValidationAlert
              type="error"
              message={error}
              action={
                <Button color="inherit" size="small" onClick={onRetrySubscriptions}>
                  {t('Retry')}
                </Button>
              }
            />
          </Box>
        )}

        {/* Cluster */}
        <SearchableSelect
          label={t('Cluster')}
          value={formData.cluster}
          onChange={value => handleClusterChange(value)}
          options={clusterOptions}
          loading={loadingClusters}
          error={!!clusterError}
          disabled={loadingClusters || !formData.subscription}
          placeholder={
            !formData.subscription
              ? t('Please select a subscription first')
              : loadingClusters
              ? t('Loading clusters...')
              : t('Select a cluster...')
          }
          searchPlaceholder={t('Search clusters...')}
          noResultsText={t(
            'No clusters with Azure Entra ID authentication found for this subscription'
          )}
          showSearch
          helperText={t(
            'Only clusters with Azure Entra ID authentication are shown and eligible for projects. {{details}}',
            {
              details: loadingClusters
                ? ''
                : clusters.length === 0
                ? t('No clusters with Azure Entra ID authentication found in this subscription')
                : t('{{count}} cluster{{suffix}} with Azure Entra ID authentication found', {
                    count: clusters.length,
                    suffix: clusters.length !== 1 ? 's' : '',
                  }),
            }
          )}
        />

        {formData.subscription && selectedCluster && isClusterMissing && (
          <RegisterCluster
            cluster={selectedCluster.name}
            resourceGroup={selectedCluster.resourceGroup}
            subscription={formData.subscription}
          />
        )}

        {/* This shows a warning if the cluster isn't in a ready state*/}
        {formData.cluster &&
          clusters.length > 0 &&
          (() => {
            const selectedCluster = clusters.find(c => c.name === formData.cluster);
            if (selectedCluster && isClusterNonReady(selectedCluster)) {
              const stateMessage = getClusterStateMessage(selectedCluster);
              return (
                <Box mt={1}>
                  <ValidationAlert
                    type="warning"
                    message={
                      <Box>
                        <Typography variant="body2">
                          <strong>{t('Cluster Not Ready:')}</strong> {stateMessage}
                        </Typography>
                      </Box>
                    }
                    // refresh button to reload clusters
                    action={
                      <Button
                        color="inherit"
                        size="small"
                        onClick={onRetryClusters}
                        disabled={loadingClusters}
                      >
                        {loadingClusters ? (
                          <Box display="flex" alignItems="center" gap={1}>
                            <CircularProgress size={16} color="inherit" />
                            {t('Refreshing...')}
                          </Box>
                        ) : (
                          t('Refresh')
                        )}
                      </Button>
                    }
                  />
                </Box>
              );
            }
            return null;
          })()}

        {clusterError && (
          <Box mt={1}>
            <ValidationAlert
              type="error"
              message={clusterError}
              action={
                <Button color="inherit" size="small" onClick={onRetryClusters}>
                  {t('Retry')}
                </Button>
              }
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};

function RegisterCluster({
  cluster,
  resourceGroup,
  subscription,
}: {
  cluster: string;
  resourceGroup: string;
  subscription: string;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const handleRegister = async () => {
    if (!cluster || !subscription) {
      return;
    }

    setLoading(true);
    setError(undefined);
    setSuccess(undefined);

    try {
      // Register the cluster by running az aks get-credentials and setting up kubeconfig
      console.log('[AKS] Registering cluster...');
      const result = await registerAKSCluster(subscription, resourceGroup, cluster);
      console.log('[AKS] Register cluster result:', result);
      if (!result.success) {
        setError(result.message);
        setLoading(false);
        return;
      }

      console.log('[AKS] Cluster registered successfully:', result.message);
      setSuccess(t("Cluster '{{cluster}}' successfully merged in kubeconfig", { cluster }));
      setLoading(false);
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

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {/* Show error alert for missing cluster when no success */}
      {!success && (
        <Alert severity="error">
          <AlertTitle>
            {t('Selected cluster is missing from the kubeconfig. Register it before proceeding.')}
          </AlertTitle>
        </Alert>
      )}

      {/* Show registration error if any */}
      {error && (
        <Alert severity="error" onClose={() => setError(undefined)}>
          {error}
        </Alert>
      )}

      {/* Show success message */}
      {success && (
        <Alert severity="success" onClose={() => setSuccess(undefined)}>
          {success}
        </Alert>
      )}

      {/* Hide button when success is shown */}
      {!success && (
        <Button
          onClick={handleRegister}
          variant="contained"
          startIcon={loading ? <CircularProgress /> : <Icon icon="mdi:plus" />}
          disabled={loading}
        >
          {loading ? t('Registering cluster...') : t('Register cluster')}
        </Button>
      )}
    </Box>
  );
}
