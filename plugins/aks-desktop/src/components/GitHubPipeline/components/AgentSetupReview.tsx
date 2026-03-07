// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Divider,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import ConfigureContainer from '../../DeployWizard/components/ConfigureContainer';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { AGENT_CONFIG_PATH, COPILOT_SETUP_STEPS_PATH } from '../constants';
import type { PipelineConfig } from '../types';

interface AgentSetupReviewProps {
  config: PipelineConfig;
  identityId: string;
  appName: string;
  onAppNameChange: (appName: string) => void;
  filesExist?: boolean;
  containerConfig?: {
    config: ContainerConfig;
    setConfig: React.Dispatch<React.SetStateAction<ContainerConfig>>;
  };
}

const FILE_LIST = [
  {
    path: COPILOT_SETUP_STEPS_PATH,
    description: 'Agent environment setup',
  },
  {
    path: AGENT_CONFIG_PATH,
    description: 'Agent instructions for containerization + AKS deployment',
  },
];

export function AgentSetupReview({
  config,
  identityId,
  appName,
  onAppNameChange,
  filesExist = false,
  containerConfig,
}: AgentSetupReviewProps) {
  const needsAppName = !config.appName.trim();

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Icon icon="mdi:file-document-plus-outline" width={28} height={28} />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          Setup Copilot Agent
        </Typography>
      </Box>

      {filesExist ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          Agent config files already exist in{' '}
          <strong>
            {config.repo.owner}/{config.repo.repo}
          </strong>
          . Provide the configuration below to trigger the Copilot agent.
        </Typography>
      ) : (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            A setup PR will be created in{' '}
            <strong>
              {config.repo.owner}/{config.repo.repo}
            </strong>{' '}
            with the following files:
          </Typography>

          <Box sx={{ mb: 3 }}>
            {FILE_LIST.map(file => (
              <Box
                key={file.path}
                sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}
              >
                <Icon
                  icon="mdi:file-code-outline"
                  width={18}
                  height={18}
                  style={{ marginTop: 3 }}
                />
                <Box>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {file.path}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {file.description}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </>
      )}

      <Divider sx={{ mb: 2 }} />

      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        AKS Configuration
      </Typography>
      <Box sx={{ mb: 3, pl: 1 }}>
        <Typography variant="body2">
          <strong>Cluster:</strong> {config.clusterName}
        </Typography>
        <Typography variant="body2">
          <strong>Resource Group:</strong> {config.resourceGroup}
        </Typography>
        <Typography variant="body2">
          <strong>Namespace:</strong> {config.namespace}
        </Typography>
        <Typography variant="body2">
          <strong>Service Type:</strong> {config.serviceType}
        </Typography>
      </Box>

      {needsAppName && (
        <Box sx={{ mb: 2 }}>
          <TextField
            label="Application Name"
            helperText="Used for K8s resource naming and PR titles"
            value={appName}
            onChange={e => onAppNameChange(e.target.value)}
            size="small"
            fullWidth
            required
          />
        </Box>
      )}

      {identityId && (
        <Box sx={{ mb: 3 }}>
          <TextField
            label="Workload Identity Client ID (auto-configured)"
            value={identityId}
            size="small"
            fullWidth
            InputProps={{ readOnly: true }}
          />
        </Box>
      )}

      {!filesExist && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          After you approve the setup PR, the Copilot agent will analyze your repo and create a
          deployment PR with Dockerfile, K8s manifests, and a GitHub Actions deploy workflow.
        </Typography>
      )}

      {containerConfig && (
        <Accordion
          disableGutters
          elevation={0}
          sx={{
            mb: 2,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            '&::before': { display: 'none' },
          }}
        >
          <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />} sx={{ px: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Icon icon="mdi:cog-outline" width={18} height={18} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Container Deployment Settings
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2, pt: 0 }}>
            <ConfigureContainer containerConfig={containerConfig} requireContainerImage={false} />
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}
