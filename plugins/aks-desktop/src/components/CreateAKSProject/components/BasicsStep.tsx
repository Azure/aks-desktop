// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  FormControl,
  Typography,
} from '@mui/material';
import React from 'react';
import type { ClusterCapabilities } from '../../../types/ClusterCapabilities';
import { FormField } from '../../shared/FormField';
import { useBasicsStep } from '../hooks/useBasicsStep';
import { useRegisterCluster } from '../hooks/useRegisterCluster';
import type { BasicsStepProps } from '../types';
import { ClusterConfigurePanel } from './ClusterConfigurePanel';
import { SearchableSelect } from './SearchableSelect';
import { ValidationAlert } from './ValidationAlert';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns `true` when there are addons that can still be enabled post-creation. */
const hasConfigurableAddons = (cap: ClusterCapabilities | null): boolean => {
  if (!cap) return false;
  return cap.prometheusEnabled !== true || cap.kedaEnabled !== true || cap.vpaEnabled !== true;
};

// ---------------------------------------------------------------------------
// RegisterCluster sub-component (pure presentation)
// ---------------------------------------------------------------------------

/**
 * Props for {@link RegisterCluster}.
 */
interface RegisterClusterProps {
  cluster: string;
  resourceGroup: string;
  subscription: string;
  tenantId?: string;
}

/**
 * Presentational component that prompts the user to register a cluster that
 * is selected in the form but absent from the headlamp kubeconfig.
 *
 * All async logic lives in {@link useRegisterCluster}.
 */
function RegisterCluster({ cluster, resourceGroup, subscription, tenantId }: RegisterClusterProps) {
  const { t } = useTranslation();
  const { loading, error, success, handleRegister, clearError, clearSuccess } = useRegisterCluster(
    cluster,
    resourceGroup,
    subscription,
    tenantId
  );

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {/* Missing-cluster notice — hidden once registration succeeds */}
      {!success && (
        <Alert severity="error">
          <AlertTitle>
            {t('Selected cluster is missing from the kubeconfig. Register it before proceeding.')}
          </AlertTitle>
        </Alert>
      )}

      {/* Registration error */}
      {error && (
        <Alert severity="error" onClose={clearError}>
          {error}
        </Alert>
      )}

      {/* Registration success */}
      {success && (
        <Alert severity="success" onClose={clearSuccess}>
          {success}
        </Alert>
      )}

      {/* Register button — hidden once registration succeeds */}
      {!success && (
        <Button
          onClick={handleRegister}
          variant="contained"
          startIcon={
            loading ? (
              <CircularProgress aria-hidden="true" />
            ) : (
              <Icon icon="mdi:plus" aria-hidden="true" />
            )
          }
          disabled={loading}
          aria-busy={loading || undefined}
        >
          {loading ? `${t('Registering cluster')}...` : t('Register Cluster')}
        </Button>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// BasicsStep component (pure presentation)
// ---------------------------------------------------------------------------

/**
 * Basics step of the Create AKS Project wizard.
 *
 * Collects the project name, description, Azure subscription, and AKS cluster.
 * Also surfaces pre-flight warnings and errors for the AKS Preview extension,
 * the ManagedNamespacePreview feature flag, cluster readiness, cluster
 * capabilities, and namespace name availability.
 *
 * All stateful logic (focus management, auto-select, option mapping, cluster
 * state derivation) lives in {@link useBasicsStep}. The `RegisterCluster`
 * sub-component's async flow lives in {@link useRegisterCluster}.
 */
export const BasicsStep: React.FC<BasicsStepProps> = props => {
  const { t } = useTranslation();
  const {
    formData,
    validation,
    loading = false,
    error = null,
    loadingClusters,
    clusterError,
    extensionStatus,
    featureStatus,
    namespaceStatus,
    clusterCapabilities,
    capabilitiesLoading,
    onInstallExtension,
    onRegisterFeature,
    onRetrySubscriptions,
    onRetryClusters,
    onRefreshCapabilities,
  } = props;

  const {
    projectNameRef,
    subscriptionOptions,
    clusterOptions,
    clusterHelperText,
    selectedSubscription,
    selectedCluster,
    isClusterMissing,
    nonReadyCluster,
    handleInputChange,
    handleClusterChange,
  } = useBasicsStep(props);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {error && <ValidationAlert type="error" message={error} onClose={() => {}} />}

      {/* AKS Preview Extension check */}
      {extensionStatus.installed === false && (
        <ValidationAlert
          type="warning"
          message={
            <Box>
              <Typography variant="body2">
                <strong>{t('AKS Preview Extension Required')}:</strong>{' '}
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
            /* aria-busy signals to AT that this button is performing an async operation.
               The CircularProgress spinner is hidden with aria-hidden because the button
               text ("Installing...") already conveys the busy state to screen readers.
               MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy
               MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden */
            <Button
              color="inherit"
              size="small"
              onClick={onInstallExtension}
              disabled={extensionStatus.installing}
              aria-busy={extensionStatus.installing || undefined}
            >
              {extensionStatus.installing ? (
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={16} color="inherit" aria-hidden="true" />
                  {`${t('Installing')}...`}
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
          message={'✓ ' + t('AKS Preview Extension installed successfully!')}
        />
      )}

      {/* ManagedNamespacePreview feature flag check */}
      {featureStatus.registered === false && (
        <ValidationAlert
          type="error"
          message={
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="h6" component="div">
                Feature Flag Required
              </Typography>
              <Typography variant="body2">
                {t(
                  'The ManagedNamespacePreview feature must be registered to create managed namespaces.'
                )}
              </Typography>
              {featureStatus.state && (
                <Typography variant="body2">
                  {t('Current state')}: <strong>{featureStatus.state}</strong>
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
                aria-busy={featureStatus.registering || undefined}
              >
                {featureStatus.registering ? (
                  <Box display="flex" alignItems="center" gap={1}>
                    <CircularProgress size={16} color="inherit" aria-hidden="true" />
                    {t('Registering')}...
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
          message={'✓ ' + t('ManagedNamespacePreview feature registered successfully!')}
        />
      )}

      <Box sx={{ display: 'flex', gap: 3, flexDirection: 'column' }}>
        {/* Project Name */}
        <FormControl fullWidth variant="outlined">
          <FormField
            label={t('Project Name')}
            value={formData.projectName}
            onChange={value => handleInputChange('projectName', value)}
            inputRef={projectNameRef}
            error={
              namespaceStatus.exists === true ||
              (validation.fieldErrors?.projectName && validation.fieldErrors.projectName.length > 0)
            }
            helperText={
              namespaceStatus.checking
                ? `${t('Checking if another project exists with same name')}...`
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
            endAdornment={<Icon icon="mdi:edit" aria-hidden="true" />}
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
            placeholder={`${t('Enter project description')}...`}
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
          placeholder={`${t('Select a subscription')}...`}
          searchPlaceholder={`${t('Search subscriptions')}...`}
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
          onChange={handleClusterChange}
          options={clusterOptions}
          loading={loadingClusters}
          error={!!clusterError}
          disabled={loadingClusters || !formData.subscription}
          placeholder={
            !formData.subscription
              ? t('Please select a subscription first')
              : loadingClusters
              ? `${t('Loading clusters')}...`
              : `${t('Select a cluster')}...`
          }
          searchPlaceholder={`${t('Search clusters')}...`}
          noResultsText={t(
            'No clusters with Azure Entra ID authentication found for this subscription'
          )}
          showSearch
          helperText={clusterHelperText}
        />

        {/* Register cluster if it's missing from the kubeconfig */}
        {formData.subscription && selectedCluster && isClusterMissing && (
          <RegisterCluster
            cluster={selectedCluster.name}
            resourceGroup={selectedCluster.resourceGroup}
            subscription={formData.subscription}
            tenantId={selectedSubscription?.tenant}
          />
        )}

        {/* Cluster readiness warning */}
        {nonReadyCluster && (
          <Box mt={1}>
            <ValidationAlert
              type="warning"
              message={
                <Box>
                  <Typography variant="body2">
                    <strong>{t('Cluster Not Ready')}:</strong> {nonReadyCluster.message}
                  </Typography>
                </Box>
              }
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={onRetryClusters}
                  disabled={loadingClusters}
                  aria-busy={loadingClusters || undefined}
                >
                  {loadingClusters ? (
                    <Box display="flex" alignItems="center" gap={1}>
                      <CircularProgress size={16} color="inherit" aria-hidden="true" />
                      {t('Refreshing')}...
                    </Box>
                  ) : (
                    t('Refresh')
                  )}
                </Button>
              }
            />
          </Box>
        )}

        {/* Cluster capability warnings */}
        {validation.warnings.length > 0 && (
          <>
            {validation.warnings.map((warning, index) => (
              <Box mt={1} key={`cap-warning-${index}`}>
                <ValidationAlert type="warning" message={warning} />
              </Box>
            ))}
          </>
        )}

        {/* Configure panel for enabling missing addons */}
        {formData.cluster && clusterCapabilities && hasConfigurableAddons(clusterCapabilities) && (
          <Box mt={2}>
            <ClusterConfigurePanel
              capabilities={clusterCapabilities}
              subscriptionId={formData.subscription}
              resourceGroup={formData.resourceGroup}
              clusterName={formData.cluster}
              onConfigured={() => onRefreshCapabilities?.()}
            />
          </Box>
        )}

        {/* Capabilities loading indicator */}
        {capabilitiesLoading && formData.cluster && (
          <Box mt={1}>
            <Typography variant="body2" color="text.secondary">
              Checking cluster capabilities...
            </Typography>
          </Box>
        )}

        {/* Cluster fetch error */}
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
