// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Alert, Box, Button, Typography } from '@mui/material';
import React, { useEffect, useRef } from 'react';
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
  namespace: string;
  repo: GitHubRepo;
  identitySetup: UseWorkloadIdentitySetupReturn;
}

const STATUS_STEPS = [
  { key: 'checking', label: 'Checking for existing identity...' },
  { key: 'creating-identity', label: 'Creating managed identity...' },
  { key: 'assigning-role', label: 'Assigning AKS Cluster User Role...' },
  { key: 'creating-credential', label: 'Configuring federated credential...' },
  { key: 'done', label: 'Workload identity configured' },
] as const;

const STATUS_ORDER = STATUS_STEPS.map(s => s.key);

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
  namespace,
  repo,
  identitySetup,
}: WorkloadIdentitySetupProps) {
  const { status, error, setupWorkloadIdentity } = identitySetup;
  const identityName = getIdentityName(namespace);

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
      namespace,
      repo,
    };
    setupWorkloadIdentity(config);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Icon icon="mdi:shield-key-outline" width={28} height={28} />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          Configure Workload Identity
        </Typography>
      </Box>

      {status === 'idle' ? (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            The following Azure resources will be created to enable your GitHub Actions pipeline to
            authenticate with your AKS cluster:
          </Typography>

          <Box sx={{ mb: 3, pl: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
              <Icon icon="mdi:identifier" width={20} height={20} style={{ marginTop: 2 }} />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Managed Identity
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  <code>{identityName}</code> in resource group <code>{resourceGroup}</code>
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
                  Role Assignment
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  &quot;AKS Cluster User Role&quot; scoped to the resource group
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Icon icon="mdi:handshake-outline" width={20} height={20} style={{ marginTop: 2 }} />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Federated Credential
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  OIDC trust for{' '}
                  <code>
                    {repo.owner}/{repo.repo}
                  </code>{' '}
                  (branch: <code>{repo.defaultBranch}</code>)
                </Typography>
              </Box>
            </Box>
          </Box>

          <Button
            variant="contained"
            onClick={handleSetup}
            startIcon={<Icon icon="mdi:shield-check-outline" />}
            sx={{ textTransform: 'none' }}
          >
            Continue
          </Button>
        </>
      ) : (
        <>
          <Box sx={{ mb: 3 }}>
            {STATUS_STEPS.map(step => (
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
            <Button
              variant="outlined"
              onClick={handleSetup}
              startIcon={<Icon icon="mdi:refresh" />}
              sx={{ textTransform: 'none' }}
            >
              Retry
            </Button>
          )}

          {status === 'done' && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Workload identity configured successfully.
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
