// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import type {
  UseWorkloadIdentitySetupReturn,
  WorkloadIdentitySetupConfig,
} from '../hooks/useWorkloadIdentitySetup';
import { getIdentityName } from '../hooks/useWorkloadIdentitySetup';
import type { StepStatus } from './StepStatusIcon';
import { StepStatusIcon } from './StepStatusIcon';

type NamespaceContext =
  | { isManagedNamespace: true; namespaceName: string }
  | { isManagedNamespace: false; namespaceName?: string };

type WorkloadIdentitySetupProps = {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  repo: GitHubRepo;
  identitySetup: UseWorkloadIdentitySetupReturn;
  projectName: string;
  /** Full Azure resource ID of the ACR. Omit to skip ACR roles. */
  acrResourceId?: string;
  /** Whether Azure RBAC for Kubernetes is enabled on the cluster. */
  azureRbacEnabled?: boolean;
  /** Whether the Azure RBAC capability lookup has completed. */
  azureRbacResolved?: boolean;
  /** Error returned while resolving cluster/namespace capabilities. */
  capabilitiesError?: string | null;
  /** Retries the failed cluster/namespace capability lookup. */
  onRetryCapabilities?: () => void;
} & NamespaceContext;

const BASE_STATUS_ORDER = [
  'creating-rg',
  'checking',
  'creating-identity',
  'assigning-roles',
  'creating-credential',
] as const;

/**
 * Returns the ordered list of status keys that the setup flow will walk through.
 * The optional `creating-rolebinding` step is only inserted when we'll be creating
 * a Kubernetes RoleBinding (non-Azure-RBAC clusters with a managed namespace).
 */
function getStatusOrder(includeRegistryCheck: boolean, includeRoleBinding: boolean): string[] {
  const order: string[] = includeRegistryCheck
    ? ['checking-registry', ...BASE_STATUS_ORDER]
    : [...BASE_STATUS_ORDER];
  if (includeRoleBinding) {
    return [...order, 'creating-rolebinding', 'done'];
  }
  return [...order, 'done'];
}

/**
 * Returns the rendered step list — same order as {@link getStatusOrder} but paired
 * with translated labels. Must stay in sync with that function.
 */
function getStatusSteps(
  t: (key: string) => string,
  includeRegistryCheck: boolean,
  includeRoleBinding: boolean
) {
  const steps = [
    ...(includeRegistryCheck
      ? [{ key: 'checking-registry', label: t('Checking container registry permissions...') }]
      : []),
    { key: 'creating-rg', label: t('Ensuring resource group exists...') },
    { key: 'checking', label: t('Checking for existing identity...') },
    { key: 'creating-identity', label: t('Creating managed identity...') },
    { key: 'assigning-roles', label: t('Assigning required Azure RBAC roles...') },
    { key: 'creating-credential', label: t('Configuring federated credential...') },
  ];
  if (includeRoleBinding) {
    steps.push({ key: 'creating-rolebinding', label: t('Creating Kubernetes RBAC binding...') });
  }
  steps.push({ key: 'done', label: t('Workload identity configured') });
  return steps;
}

/**
 * Resolves the display state for a single step given the current flow status.
 * When the flow has hit an error, the step the error occurred on is marked 'error'
 * and earlier steps retain 'done'; that way the user can see which step failed.
 */
function getStepStatus(
  step: string,
  currentStatus: string,
  lastActiveStatus: string,
  statusOrder: readonly string[]
): StepStatus {
  const effectiveStatus = currentStatus === 'error' ? lastActiveStatus : currentStatus;
  const effectiveIdx = statusOrder.indexOf(effectiveStatus);
  const stepIdx = statusOrder.indexOf(step);

  if (stepIdx < effectiveIdx || effectiveStatus === 'done') return 'done';
  if (stepIdx === effectiveIdx && currentStatus === 'error') return 'error';
  if (stepIdx === effectiveIdx) return 'active';
  return 'pending';
}

export function WorkloadIdentitySetup({
  subscriptionId,
  resourceGroup,
  clusterName,
  repo,
  identitySetup,
  projectName,
  acrResourceId,
  isManagedNamespace,
  namespaceName,
  azureRbacEnabled,
  azureRbacResolved = true,
  capabilitiesError,
  onRetryCapabilities,
}: WorkloadIdentitySetupProps) {
  const {
    status,
    error,
    result,
    setupWorkloadIdentity,
    existingIdentity,
    identityResolutionStatus,
    identityResolutionError,
    servicePrincipalPullRequired,
  } = identitySetup;
  const { t } = useTranslation();
  const identityName =
    existingIdentity?.identityName ??
    (identityResolutionStatus ? t('Saved managed identity') : getIdentityName(projectName));
  const needsRegistryCheck = Boolean(acrResourceId);
  const needsRoleBinding = azureRbacEnabled === false && isManagedNamespace === true;
  const statusOrder = getStatusOrder(needsRegistryCheck, needsRoleBinding);
  const statusSteps = getStatusSteps(t, needsRegistryCheck, needsRoleBinding);
  const [identityRG, setIdentityRG] = useState(identityResolutionStatus ? '' : `rg-${projectName}`);
  const [acknowledgeServicePrincipalPull, setAcknowledgeServicePrincipalPull] = useState(false);

  useEffect(() => {
    setIdentityRG(
      existingIdentity?.identityResourceGroup ??
        (identityResolutionStatus ? '' : `rg-${projectName}`)
    );
  }, [projectName, existingIdentity?.identityResourceGroup, identityResolutionStatus]);

  useEffect(() => {
    setAcknowledgeServicePrincipalPull(false);
  }, [
    subscriptionId,
    resourceGroup,
    clusterName,
    namespaceName,
    acrResourceId,
    repo.owner,
    repo.repo,
    repo.defaultBranch,
    existingIdentity?.clientId,
  ]);

  // Track the last non-error status so StepIcon can show which step failed
  const lastActiveStatusRef = useRef(status);
  useEffect(() => {
    if (status !== 'error' && status !== 'idle') {
      lastActiveStatusRef.current = status;
    }
  }, [status]);

  const handleSetup = () => {
    const base = {
      subscriptionId,
      resourceGroup,
      identityResourceGroup: identityRG.trim(),
      projectName,
      clusterName,
      repo,
      acrResourceId,
      azureRbacEnabled,
      ...(acknowledgeServicePrincipalPull && { acknowledgeServicePrincipalPull: true }),
    };
    const config: WorkloadIdentitySetupConfig = isManagedNamespace
      ? { ...base, isManagedNamespace: true, namespaceName }
      : { ...base, isManagedNamespace: false, namespaceName };
    setupWorkloadIdentity(config);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Icon icon="mdi:shield-key-outline" width={28} height={28} />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t('Configure Workload Identity')}
        </Typography>
      </Box>

      {identityResolutionStatus === 'loading' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('Resolving the saved managed identity...')}
        </Alert>
      )}
      {identityResolutionError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {identityResolutionError}
        </Alert>
      )}
      {existingIdentity && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('Reusing the saved managed identity. No replacement identity will be created.')}
        </Alert>
      )}

      {status === 'idle' ? (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {identityResolutionStatus
              ? t(
                  'The saved managed identity and its permissions will be revalidated for this pipeline.'
                )
              : t(
                  'The following Azure resources will be created to enable your GitHub Actions pipeline to authenticate with your AKS cluster:'
                )}
          </Typography>

          <Box sx={{ mb: 3, pl: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
              <Icon icon="mdi:identifier" width={20} height={20} style={{ marginTop: 2 }} />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('Managed Identity')}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  <code>{identityName}</code> {t('in resource group')} <code>{identityRG}</code>
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
              <Icon
                icon="mdi:account-key-outline"
                width={20}
                height={20}
                style={{ marginTop: 2 }}
              />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('Role Assignments')}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t(
                    'Required Azure RBAC roles for cluster access, deployment, and container registry'
                  )}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Icon icon="mdi:handshake-outline" width={20} height={20} style={{ marginTop: 2 }} />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('Federated Credential')}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('OIDC trust for')}{' '}
                  <code>
                    {repo.owner}/{repo.repo}
                  </code>{' '}
                  ({t('branch')}: <code>{repo.defaultBranch}</code>)
                </Typography>
              </Box>
            </Box>
          </Box>

          <TextField
            label={t('Identity Resource Group')}
            size="small"
            value={identityRG}
            InputProps={{ readOnly: !!identityResolutionStatus }}
            onChange={e => setIdentityRG(e.target.value)}
            fullWidth
            helperText={
              identityResolutionStatus
                ? t('Resource group of the saved managed identity')
                : t('Resource group where the managed identity will be created')
            }
            sx={{ mb: 3 }}
          />

          {capabilitiesError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                onRetryCapabilities ? (
                  <Button color="inherit" size="small" onClick={onRetryCapabilities}>
                    {t('Retry')}
                  </Button>
                ) : undefined
              }
            >
              {capabilitiesError}
            </Alert>
          )}

          <Button
            variant="contained"
            onClick={handleSetup}
            startIcon={<Icon icon="mdi:shield-check-outline" aria-hidden="true" />}
            sx={{ textTransform: 'none' }}
            disabled={
              (!identityRG.trim() && !identityResolutionStatus) ||
              identityResolutionStatus === 'loading' ||
              !azureRbacResolved
            }
          >
            {t('Continue')}
          </Button>
        </>
      ) : (
        <>
          <Box sx={{ mb: 3 }}>
            {statusSteps.map(step => (
              <Box key={step.key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                <StepStatusIcon
                  status={getStepStatus(step.key, status, lastActiveStatusRef.current, statusOrder)}
                />
                <Typography
                  variant="body2"
                  sx={{
                    color:
                      statusOrder.indexOf(step.key) <=
                      statusOrder.indexOf(status === 'error' ? lastActiveStatusRef.current : status)
                        ? 'text.primary'
                        : 'text.disabled',
                  }}
                >
                  {step.label}
                </Typography>
              </Box>
            ))}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {status === 'error' && (
            <>
              <TextField
                label={t('Identity Resource Group')}
                size="small"
                value={identityRG}
                InputProps={{ readOnly: !!identityResolutionStatus }}
                onChange={e => setIdentityRG(e.target.value)}
                fullWidth
                helperText={
                  identityResolutionStatus
                    ? t('Resource group of the saved managed identity')
                    : t('Resource group where the managed identity will be created')
                }
                sx={{ mb: 2 }}
              />
              {servicePrincipalPullRequired && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={acknowledgeServicePrincipalPull}
                      onChange={event => setAcknowledgeServicePrincipalPull(event.target.checked)}
                    />
                  }
                  label={t(
                    'I manually verified that this service-principal cluster can pull images from the selected registry.'
                  )}
                  sx={{ mb: 2 }}
                />
              )}
              <Button
                variant="outlined"
                onClick={handleSetup}
                startIcon={<Icon icon="mdi:refresh" aria-hidden="true" />}
                sx={{ textTransform: 'none' }}
                disabled={
                  (!identityRG.trim() && !identityResolutionStatus) ||
                  identityResolutionStatus === 'loading' ||
                  (!!servicePrincipalPullRequired && !acknowledgeServicePrincipalPull)
                }
              >
                {t('Retry')}
              </Button>
            </>
          )}

          {status === 'done' && (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                {t('Workload identity configured successfully.')}
              </Alert>
              {result?.servicePrincipalPullAcknowledged && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t('Registry pull access was manually acknowledged, not automatically verified.')}
                </Alert>
              )}
              {(result?.warnings ?? []).map((warning, i) => (
                <Alert key={i} severity="warning" sx={{ mb: 1 }}>
                  {warning}
                </Alert>
              ))}
            </>
          )}
        </>
      )}
    </Box>
  );
}
