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
import { getClusterSettings, setClusterSettings } from '../../../utils/shared/clusterSettings';
import { aksHybridEdgePreOpenHook } from '../../AksHybridEdge/aksHybridEdgePreOpen';
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
  /** Kubeconfig context and Azure cluster name. */
  cluster: string;
  /** Azure resource group containing the cluster. */
  resourceGroup: string;
  /** Azure subscription ID containing the cluster. */
  subscription: string;
  /** Optional tenant ID used when fetching managed-cluster credentials. */
  tenantId?: string;
}

/**
 * Presentational component that prompts the user to register a cluster that
 * is selected in the form but absent from the headlamp kubeconfig.
 *
 * All async logic lives in {@link useRegisterCluster}.
 */
function RegisterCluster({ cluster, resourceGroup, subscription }: RegisterClusterProps) {
  const { t } = useTranslation();
  const { loading, clusterConfigReady, error, success, handleRegister, clearError, clearSuccess } =
    useRegisterCluster(cluster, resourceGroup, subscription);

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
          disabled={loading || !clusterConfigReady}
          aria-busy={loading || undefined}
        >
          {loading ? `${t('Registering cluster')}...` : t('Register Cluster')}
        </Button>
      )}
    </Box>
  );
}

/**
 * Props for {@link ConnectArcCluster}.
 */
interface ConnectArcClusterProps {
  /** Kubeconfig context and Azure Arc connected-cluster name. */
  cluster: string;
  /** Azure resource group containing the Arc resource. */
  resourceGroup: string;
  /** Azure subscription ID containing the Arc resource. */
  subscription: string;
}

/**
 * AKS Hybrid & Edge (Arc) counterpart to {@link RegisterCluster}. Arc clusters
 * can't be registered with `az aks get-credentials`; they're connected by
 * starting `az connectedk8s proxy`. This offers that inline (matching the managed
 * "Register Cluster" affordance) so the user doesn't have to leave the wizard for
 * the Add Cluster dialog.
 *
 * It reuses the app's existing Arc connect flow: persist the Azure coordinates the
 * flow reads from cluster settings, then delegate to {@link aksHybridEdgePreOpenHook}
 * — the same logic used when opening an Arc cluster (start the proxy, wait for the
 * kubeconfig context, verify the API answers, and badge it). A proxy that fails
 * verification is deliberately left running: arcProxy is a machine-wide daemon
 * shared by every connected cluster, so tearing it down here would disconnect the
 * others. Once the context loads, `isClusterMissing` clears on its own.
 */
function ConnectArcCluster({ cluster, resourceGroup, subscription }: ConnectArcClusterProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [success, setSuccess] = React.useState<string | undefined>(undefined);

  const handleConnect = async () => {
    if (!cluster || !resourceGroup || !subscription) {
      return;
    }
    setLoading(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      // Persist the Azure coordinates the shared connect flow reads from cluster
      // settings, then reuse the app's existing Arc connect-on-open logic.
      const existing = getClusterSettings(cluster);
      setClusterSettings(cluster, {
        ...existing,
        clusterType: 'aksarc',
        subscriptionId: subscription,
        resourceGroup,
      });
      await aksHybridEdgePreOpenHook({ cluster });
      setSuccess(t("Cluster '{{cluster}}' successfully connected", { cluster }));
    } catch (err) {
      setError(
        t('Failed to connect to the AKS Hybrid & Edge cluster: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => setError(undefined);
  const clearSuccess = () => setSuccess(undefined);

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {/* Not-connected notice — hidden once connected. Matches RegisterCluster's
          severity/layout so managed and Arc clusters look the same. */}
      {!success && (
        <Alert severity="error">
          <AlertTitle>
            {t(
              'This AKS Hybrid & Edge cluster is not connected yet. Connect it before proceeding.'
            )}
          </AlertTitle>
        </Alert>
      )}

      {/* Connect error */}
      {error && (
        <Alert severity="error" onClose={clearError}>
          {error}
        </Alert>
      )}

      {/* Connect success */}
      {success && (
        <Alert severity="success" onClose={clearSuccess}>
          {success}
        </Alert>
      )}

      {/* Connect button — hidden once connected */}
      {!success && (
        <Button
          onClick={handleConnect}
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
          {loading ? `${t('Connecting cluster')}...` : t('Connect Cluster')}
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
 * Also surfaces pre-flight warnings and errors for cluster readiness, cluster
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
    arcDiscoveryUnavailable,
    namespaceStatus,
    clusterAccessStatus,
    clusterCapabilities,
    capabilitiesLoading,
    onRetrySubscriptions,
    onRetryClusters,
    onRefreshCapabilities,
  } = props;

  const {
    projectNameRef,
    subscriptionOptions,
    clusterOptions,
    selectedClusterValue,
    clusterHelperText,
    selectedSubscription,
    selectedCluster,
    isClusterMissing,
    clusterScopeConflict,
    nonReadyCluster,
    handleInputChange,
    handleClusterChange,
  } = useBasicsStep(props);

  // Arc (AKS Hybrid & Edge) clusters apply a native manifest via the K8s API, so
  // the managed-namespace prerequisites (aks-preview extension, ManagedNamespacePreview
  // feature) and the `az aks get-credentials` register affordance do not apply.
  const isArc = selectedCluster?.clusterType === 'aksarc';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {error && <ValidationAlert type="error" message={error} onClose={() => {}} />}

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
          value={selectedClusterValue}
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
        {formData.subscription && selectedCluster && clusterScopeConflict && (
          <ValidationAlert
            type="error"
            message={t(
              'A different or unknown Azure cluster scope is already registered with this name. Remove it before continuing.'
            )}
          />
        )}

        {arcDiscoveryUnavailable && (
          <ValidationAlert
            type="warning"
            message={t(
              'AKS Hybrid & Edge clusters are not listed: the Azure CLI "connectedk8s" extension is required. Install it with: az extension add --name connectedk8s'
            )}
          />
        )}

        {/* Register/connect the cluster if it's missing from the kubeconfig.
            Managed AKS clusters register via `az aks get-credentials` (RegisterCluster);
            Arc (AKS Hybrid & Edge) clusters connect via `az connectedk8s proxy`
            (ConnectArcCluster). Either way it happens inline — no trip to Add Cluster. */}
        {formData.subscription &&
          selectedCluster &&
          isClusterMissing &&
          !clusterScopeConflict &&
          (isArc ? (
            <ConnectArcCluster
              cluster={selectedCluster.name}
              resourceGroup={selectedCluster.resourceGroup}
              subscription={formData.subscription}
            />
          ) : (
            <RegisterCluster
              cluster={selectedCluster.name}
              resourceGroup={selectedCluster.resourceGroup}
              subscription={formData.subscription}
              tenantId={selectedSubscription?.tenant}
            />
          ))}

        {/* Live accessibility of a connected Arc cluster. A cluster can report a
            "Succeeded" state in Azure yet be unreachable (proxy down / offline);
            verified with a real Kubernetes API probe. Blocks "Next" while checking
            or when unreachable. */}
        {isArc && selectedCluster && !isClusterMissing && clusterAccessStatus.checking && (
          <ValidationAlert
            type="info"
            message={
              <Box display="flex" alignItems="center" gap={1}>
                <CircularProgress size={16} aria-hidden="true" />
                {`${t('Checking cluster accessibility')}...`}
              </Box>
            }
          />
        )}
        {isArc &&
          selectedCluster &&
          !isClusterMissing &&
          !clusterAccessStatus.checking &&
          clusterAccessStatus.accessible === false && (
            <ValidationAlert
              type="error"
              message={t(
                'Cluster "{{cluster}}" is not accessible — its Kubernetes API did not respond. It may be stopped or offline. Start it or check its health in the Azure portal, then retry.',
                { cluster: selectedCluster.name }
              )}
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
