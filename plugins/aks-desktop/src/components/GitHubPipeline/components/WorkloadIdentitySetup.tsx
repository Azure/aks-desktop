// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import type {
  UseWorkloadIdentitySetupReturn,
  WorkloadIdentitySetupConfig,
} from '../hooks/useWorkloadIdentitySetup';
import { getIdentityName } from '../hooks/useWorkloadIdentitySetup';
import type { StepStatus } from './StepStatusIcon';
import { StepStatusIcon } from './StepStatusIcon';

interface WorkloadIdentitySetupProps {
  subscriptionId: string;
  resourceGroup: string;
  repo: GitHubRepo;
  identitySetup: UseWorkloadIdentitySetupReturn;
  projectName: string;
}

const STATUS_ORDER = [
  'creating-rg',
  'checking',
  'creating-identity',
  'assigning-role',
  'creating-credential',
  'done',
] as const;

function getStatusSteps(t: (key: string) => string) {
  return [
    { key: 'creating-rg', label: t('Ensuring resource group exists...') },
    { key: 'checking', label: t('Checking for existing identity...') },
    { key: 'creating-identity', label: t('Creating managed identity...') },
    { key: 'assigning-role', label: t('Assigning AKS Cluster User Role...') },
    { key: 'creating-credential', label: t('Configuring federated credential...') },
    { key: 'done', label: t('Workload identity configured') },
  ] as const;
}

function getStepStatus(step: string, currentStatus: string, lastActiveStatus: string): StepStatus {
  const effectiveStatus = currentStatus === 'error' ? lastActiveStatus : currentStatus;
  const effectiveIdx = STATUS_ORDER.indexOf(effectiveStatus as (typeof STATUS_ORDER)[number]);
  const stepIdx = STATUS_ORDER.indexOf(step as (typeof STATUS_ORDER)[number]);

  if (stepIdx < effectiveIdx || effectiveStatus === 'done') return 'done';
  if (stepIdx === effectiveIdx && currentStatus === 'error') return 'error';
  if (stepIdx === effectiveIdx) return 'active';
  return 'pending';
}

export function WorkloadIdentitySetup({
  subscriptionId,
  resourceGroup,
  repo,
  identitySetup,
  projectName,
}: WorkloadIdentitySetupProps) {
  const { status, error, setupWorkloadIdentity } = identitySetup;
  const { t } = useTranslation();
  const identityName = getIdentityName(projectName);
  const statusSteps = getStatusSteps(t);
  const [identityRG, setIdentityRG] = useState(`rg-${projectName}`);

  useEffect(() => {
    setIdentityRG(`rg-${projectName}`);
  }, [projectName]);

  // Track the last non-error status so StepIcon can show which step failed
  const lastActiveStatusRef = useRef(status);
  useEffect(() => {
    if (status !== 'error' && status !== 'idle') {
      lastActiveStatusRef.current = status;
    }
  }, [status]);

  const handleSetup = () => {
    const config: WorkloadIdentitySetupConfig = {
      subscriptionId,
      resourceGroup,
      identityResourceGroup: identityRG.trim(),
      projectName,
      repo,
    };
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

      {status === 'idle' ? (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {t(
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
                  {t('Role Assignment')}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('"AKS Cluster User Role" scoped to the resource group')}
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
            onChange={e => setIdentityRG(e.target.value)}
            fullWidth
            helperText={t('Resource group where the managed identity will be created')}
            sx={{ mb: 3 }}
          />

          <Button
            variant="contained"
            onClick={handleSetup}
            startIcon={<Icon icon="mdi:shield-check-outline" aria-hidden="true" />}
            sx={{ textTransform: 'none' }}
            disabled={!identityRG.trim()}
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
                  status={getStepStatus(step.key, status, lastActiveStatusRef.current)}
                />
                <Typography
                  variant="body2"
                  sx={{
                    color:
                      STATUS_ORDER.indexOf(step.key) <=
                      STATUS_ORDER.indexOf(
                        (status === 'error'
                          ? lastActiveStatusRef.current
                          : status) as (typeof STATUS_ORDER)[number]
                      )
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
                onChange={e => setIdentityRG(e.target.value)}
                fullWidth
                helperText={t('Resource group where the managed identity will be created')}
                sx={{ mb: 2 }}
              />
              <Button
                variant="outlined"
                onClick={handleSetup}
                startIcon={<Icon icon="mdi:refresh" aria-hidden="true" />}
                sx={{ textTransform: 'none' }}
                disabled={!identityRG.trim()}
              >
                {t('Retry')}
              </Button>
            </>
          )}

          {status === 'done' && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {t('Workload identity configured successfully.')}
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
