// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Box, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import { getClusterInfo } from '../../utils/azure/az-cli';
import { ClusterDeployCard } from './components/ClusterDeployCard';
import { usePipelineSettings } from './hooks/usePipelineSettings';
import { usePipelineStatus } from './hooks/usePipelineStatus';

interface ProjectDefinition {
  id: string;
  namespaces: string[];
  clusters: string[];
}

interface DeployTabProps {
  project: ProjectDefinition;
}

function DeployTab({ project }: DeployTabProps) {
  const { settings } = usePipelineSettings();
  const pipelineStatus = usePipelineStatus();
  const azureAuth = useAzureAuth();
  const [azureContext, setAzureContext] = useState<{
    subscriptionId: string;
    resourceGroup: string;
    tenantId: string;
  } | null>(null);

  // Resolve Azure context from first cluster
  useEffect(() => {
    const cluster = project.clusters?.[0];
    if (!cluster || !azureAuth.isLoggedIn) return;
    (async () => {
      try {
        const clusterInfo = await getClusterInfo(cluster);
        setAzureContext({
          subscriptionId: clusterInfo.subscriptionId ?? '',
          resourceGroup: clusterInfo.resourceGroup ?? '',
          tenantId: azureAuth.tenantId ?? '',
        });
      } catch (error) {
        console.error('Failed to resolve Azure context:', error);
      }
    })();
  }, [project.clusters, azureAuth.isLoggedIn, azureAuth.tenantId]);

  return (
    <Box sx={{ my: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5">Deployments</Typography>
      </Box>

      {settings.githubPipelineEnabled && pipelineStatus.isConfigured && pipelineStatus.repo && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            border: '1px solid',
            borderColor: 'success.main',
            borderRadius: 1,
            backgroundColor: theme =>
              theme.palette.mode === 'dark' ? 'rgba(46, 125, 50, 0.08)' : 'rgba(46, 125, 50, 0.04)',
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Pipeline configured
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {pipelineStatus.repo.owner}/{pipelineStatus.repo.repo} — deploy-to-aks.yml
          </Typography>
        </Box>
      )}

      {project.clusters.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No clusters in this project.
        </Typography>
      )}

      {project.clusters.map((cluster, idx) => {
        const namespace = project.namespaces[idx] ?? project.namespaces[0] ?? '';
        return (
          <ClusterDeployCard
            key={cluster}
            cluster={cluster}
            namespace={namespace}
            azureContext={azureContext}
            pipelineRepo={pipelineStatus.isConfigured ? pipelineStatus.repo : null}
            pipelineEnabled={settings.githubPipelineEnabled}
          />
        );
      })}
    </Box>
  );
}

export default DeployTab;
