// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { listManagedIdentities } from '../../../utils/azure/az-identity';
import { isValidAzResourceName } from '../../../utils/azure/az-validation';
import { K8S_DNS_LABEL_PATTERN } from '../../../utils/kubernetes/k8sNames';
import { getServiceAccountName } from '../../../utils/kubernetes/serviceAccountNames';
import { CONTAINER_STEPS } from '../hooks/useContainerConfiguration';
import {
  getDeployIdentityName,
  useDeployWorkloadIdentity,
} from '../hooks/useDeployWorkloadIdentity';
import {
  type ContainerConfigProp,
  type DeployAzureContext,
  LabelWithInfo,
} from './configureContainerUtils';

interface WorkloadIdentityStepProps {
  containerConfig: ContainerConfigProp;
  azureContext?: DeployAzureContext;
  namespace?: string;
}

export default function WorkloadIdentityStep({
  containerConfig,
  azureContext,
  namespace,
}: WorkloadIdentityStepProps) {
  const { t } = useTranslation();
  const workloadIdentity = useDeployWorkloadIdentity();
  const [identityMode, setIdentityMode] = useState<'create' | 'existing'>('create');
  const derivedIdentityRg = `rg-${containerConfig.config.appName || 'app'}`;
  const [identityRg, setIdentityRg] = useState(derivedIdentityRg);
  const [identityRgTouched, setIdentityRgTouched] = useState(false);
  useEffect(() => {
    if (!identityRgTouched) {
      setIdentityRg(derivedIdentityRg);
    }
  }, [derivedIdentityRg, identityRgTouched]);
  const [existingIdentities, setExistingIdentities] = useState<
    Array<{ name: string; clientId: string; principalId: string; resourceGroup: string }>
  >([]);
  const [existingIdentityRg, setExistingIdentityRg] = useState(azureContext?.resourceGroup ?? '');
  const [loadingIdentities, setLoadingIdentities] = useState(false);
  const [identityLoadError, setIdentityLoadError] = useState<string | null>(null);
  const [identityValidationError, setIdentityValidationError] = useState<string | null>(null);
  const loadRequestRef = useRef(0);

  const handleLoadExistingIdentities = async (rg?: string) => {
    if (!azureContext) return;
    const requestId = ++loadRequestRef.current;
    setLoadingIdentities(true);
    setIdentityLoadError(null);
    try {
      const result = await listManagedIdentities({
        resourceGroup: rg || azureContext.resourceGroup,
        subscriptionId: azureContext.subscriptionId,
      });
      if (requestId !== loadRequestRef.current) return;
      if (result.success && result.identities) {
        setExistingIdentities(result.identities);
      } else {
        setIdentityLoadError(result.error ?? 'Failed to load managed identities');
      }
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      setIdentityLoadError(
        err instanceof Error ? err.message : 'Failed to load managed identities'
      );
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoadingIdentities(false);
      }
    }
  };

  return (
    <>
      <FormControlLabel
        control={
          <Switch
            checked={containerConfig.config.enableWorkloadIdentity}
            disabled={!azureContext}
            onChange={e =>
              containerConfig.setConfig(c => ({
                ...c,
                enableWorkloadIdentity: e.target.checked,
              }))
            }
          />
        }
        label={
          <LabelWithInfo
            label={t('Enable Workload Identity')}
            infoText={t(
              'Azure Workload Identity enables pods to authenticate to Azure services using a managed identity without storing credentials. Creates a service account with federated credentials.'
            )}
          />
        }
      />
      {!azureContext && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 5 }}>
          {t('Azure sign-in is required to configure workload identity.')}
        </Typography>
      )}
      {containerConfig.config.enableWorkloadIdentity && azureContext && (
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <RadioGroup
            value={identityMode}
            onChange={e => {
              const mode = e.target.value as 'create' | 'existing';
              setIdentityMode(mode);
              workloadIdentity.reset();
              if (mode === 'existing' && existingIdentities.length === 0) {
                handleLoadExistingIdentities(existingIdentityRg);
              }
            }}
            row
          >
            <FormControlLabel value="create" control={<Radio />} label={t('Create new identity')} />
            <FormControlLabel
              value="existing"
              control={<Radio />}
              label={t('Use existing identity')}
            />
          </RadioGroup>

          {identityMode === 'create' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label={t('Identity Resource Group')}
                value={identityRg}
                onChange={e => {
                  setIdentityRg(e.target.value);
                  setIdentityRgTouched(true);
                  setIdentityValidationError(null);
                }}
                helperText={t(
                  'Resource group for the managed identity. Will be created if it does not exist.'
                )}
              />
              <Button
                variant="contained"
                disabled={
                  workloadIdentity.status !== 'idle' &&
                  workloadIdentity.status !== 'error' &&
                  workloadIdentity.status !== 'done'
                }
                onClick={() => {
                  const appName = containerConfig.config.appName || 'app';
                  const derivedIdentityName = getDeployIdentityName(appName);
                  if (!isValidAzResourceName(identityRg)) {
                    setIdentityValidationError(
                      t(
                        'Identity resource group name is invalid. Use only letters, numbers, hyphens, and underscores.'
                      )
                    );
                    return;
                  }
                  if (!isValidAzResourceName(derivedIdentityName)) {
                    setIdentityValidationError(
                      t(
                        'Application name produces an invalid identity name. Use only letters, numbers, hyphens, and underscores.'
                      )
                    );
                    return;
                  }
                  const saName = getServiceAccountName(appName);
                  if (!K8S_DNS_LABEL_PATTERN.test(saName)) {
                    setIdentityValidationError(
                      t(
                        'Application name produces an invalid Kubernetes service account name. Use only lowercase letters, numbers, and hyphens.'
                      )
                    );
                    return;
                  }
                  setIdentityValidationError(null);
                  workloadIdentity.setupWorkloadIdentity({
                    subscriptionId: azureContext.subscriptionId,
                    resourceGroup: azureContext.resourceGroup,
                    identityResourceGroup: identityRg,
                    clusterName: azureContext.clusterName,
                    namespace: namespace || 'default',
                    appName,
                    isManagedNamespace: azureContext.isManagedNamespace ?? false,
                    azureRbacEnabled: azureContext.azureRbacEnabled,
                  });
                }}
                sx={{ alignSelf: 'flex-start' }}
              >
                {workloadIdentity.status === 'done'
                  ? t('Reconfigure Identity')
                  : t('Configure Identity')}
              </Button>
              {workloadIdentity.status !== 'idle' &&
                workloadIdentity.status !== 'done' &&
                workloadIdentity.status !== 'error' && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="body2" color="text.secondary">
                      {workloadIdentity.status === 'creating-rg' && t('Creating resource group...')}
                      {workloadIdentity.status === 'checking' &&
                        t('Checking for existing identity...')}
                      {workloadIdentity.status === 'creating-identity' &&
                        t('Creating managed identity...')}
                      {workloadIdentity.status === 'assigning-roles' &&
                        t('Assigning required roles...')}
                      {workloadIdentity.status === 'fetching-issuer' &&
                        t('Fetching OIDC issuer URL...')}
                      {workloadIdentity.status === 'creating-credential' &&
                        t('Creating federated credential...')}
                    </Typography>
                  </Box>
                )}
            </Box>
          )}

          {identityMode === 'existing' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  label={t('Resource Group')}
                  value={existingIdentityRg}
                  onChange={e => {
                    setExistingIdentityRg(e.target.value);
                    setExistingIdentities([]);
                    setIdentityLoadError(null);
                  }}
                  helperText={t('Resource group to search for managed identities.')}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  disabled={loadingIdentities}
                  onClick={() => handleLoadExistingIdentities(existingIdentityRg)}
                  sx={{ mt: 1 }}
                >
                  {t('Load')}
                </Button>
              </Box>
              {loadingIdentities ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2">{t('Loading identities...')}</Typography>
                </Box>
              ) : (
                <Autocomplete
                  options={existingIdentities}
                  getOptionLabel={option => `${option.name} (${option.clientId})`}
                  onChange={(_e, value) => {
                    if (value) {
                      containerConfig.setConfig(c => ({
                        ...c,
                        workloadIdentityClientId: value.clientId,
                        workloadIdentityServiceAccount: getServiceAccountName(
                          containerConfig.config.appName || 'app'
                        ),
                      }));
                    }
                  }}
                  renderInput={params => (
                    <TextField
                      {...params}
                      label={t('Select managed identity')}
                      helperText={t(
                        'Choose an existing user-assigned managed identity. You will still need to create federated credentials manually.'
                      )}
                    />
                  )}
                />
              )}
              {containerConfig.config.workloadIdentityClientId && identityMode === 'existing' && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  {t(
                    "When using an existing identity, ensure it has the required Azure RBAC roles and a federated credential for this cluster's OIDC issuer and service account."
                  )}
                </Alert>
              )}
              {identityLoadError && (
                <Typography variant="body2" color="error">
                  {identityLoadError}
                </Typography>
              )}
            </Box>
          )}

          {(workloadIdentity.error || identityValidationError) && (
            <Typography variant="body2" color="error">
              {identityValidationError || workloadIdentity.error}
            </Typography>
          )}

          {(workloadIdentity.status === 'done' ||
            containerConfig.config.workloadIdentityClientId) && (
            <Box
              sx={{
                p: 2,
                bgcolor: 'action.hover',
                borderRadius: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <Typography variant="body2">
                <strong>{t('Client ID')}:</strong>{' '}
                {workloadIdentity.result?.clientId ||
                  containerConfig.config.workloadIdentityClientId}
              </Typography>
              <Typography variant="body2">
                <strong>{t('Service Account')}:</strong>{' '}
                {workloadIdentity.result?.serviceAccountName ||
                  containerConfig.config.workloadIdentityServiceAccount}
              </Typography>
            </Box>
          )}
        </Box>
      )}
      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          onClick={() =>
            containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.HPA }))
          }
        >
          {t('Back')}
        </Button>
        <Button
          variant="contained"
          disabled={
            containerConfig.config.enableWorkloadIdentity &&
            !workloadIdentity.result &&
            !containerConfig.config.workloadIdentityClientId
          }
          onClick={() => {
            if (workloadIdentity.result) {
              containerConfig.setConfig(c => ({
                ...c,
                workloadIdentityClientId: workloadIdentity.result!.clientId,
                workloadIdentityServiceAccount: workloadIdentity.result!.serviceAccountName,
                containerStep: CONTAINER_STEPS.ADVANCED,
              }));
            } else {
              containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.ADVANCED }));
            }
          }}
        >
          {t('Continue')}
        </Button>
      </Box>
    </>
  );
}
