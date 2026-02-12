// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Button, Card, CardContent, Divider, TextField, Typography } from '@mui/material';
import React from 'react';
import type { PipelineConfig } from '../types';

interface AgentSetupReviewProps {
  /** The pipeline configuration. */
  config: PipelineConfig;
  /** Callback to create the setup PR. */
  onSetupAgent: () => void;
  /** Current workload identity client ID value. */
  identityId: string;
  /** Called when the user changes the identity ID. */
  onIdentityIdChange: (identityId: string) => void;
  /** Current app name value. */
  appName: string;
  /** Called when the user changes the app name. */
  onAppNameChange: (appName: string) => void;
  /** Whether both setup files already exist on the repo (skip PR creation). */
  filesExist?: boolean;
}

const FILE_LIST = [
  {
    path: '.github/workflows/copilot-setup-steps.yml',
    description: 'Agent environment setup',
  },
  {
    path: '.github/agents/containerization.agent.md',
    description: 'Agent instructions for containerization + AKS deployment',
  },
];

export const AgentSetupReview: React.FC<AgentSetupReviewProps> = ({
  config,
  onSetupAgent,
  identityId,
  onIdentityIdChange,
  appName,
  onAppNameChange,
  filesExist = false,
}) => {
  const needsIdentityId = !config.identityId.trim();
  const needsAppName = !config.appName.trim();

  return (
    <Card sx={{ maxWidth: 560, width: '100%', p: 3 }}>
      <CardContent>
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

        {needsIdentityId && (
          <Box sx={{ mb: 3 }}>
            <TextField
              label="Workload Identity Client ID"
              helperText="Required for OIDC authentication in the deployment workflow"
              value={identityId}
              onChange={e => onIdentityIdChange(e.target.value)}
              size="small"
              fullWidth
              required
            />
          </Box>
        )}

        {!filesExist && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            After you approve the setup PR, the Copilot agent will analyze your repo and create a
            deployment PR with Dockerfile, K8s manifests, and a GitHub Actions deploy workflow.
          </Typography>
        )}

        <Button
          variant="contained"
          color="primary"
          onClick={onSetupAgent}
          disabled={(needsIdentityId && !identityId.trim()) || (needsAppName && !appName.trim())}
          startIcon={<Icon icon={filesExist ? 'mdi:robot-outline' : 'mdi:source-pull'} />}
          sx={{ minWidth: 200, textTransform: 'none', fontSize: 15 }}
        >
          {filesExist ? 'Trigger Copilot Agent' : 'Create Setup PR'}
        </Button>
      </CardContent>
    </Card>
  );
};
