// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Button, Dialog } from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import type { GitHubRepo } from '../../types/github';
import { getClusterInfo } from '../../utils/azure/az-cli';
import GitHubPipelineWizard from '../GitHubPipeline/GitHubPipelineWizard';
import { getActivePipeline } from '../GitHubPipeline/hooks/useGitHubPipelineOrchestration';

interface ProjectDefinition {
  id: string;
  namespaces: string[];
  clusters: string[];
}

interface ConfigurePipelineButtonProps {
  project: ProjectDefinition;
}

function ConfigurePipelineButton({ project }: ConfigurePipelineButtonProps) {
  const azureAuth = useAzureAuth();
  const [azureContext, setAzureContext] = useState<{
    subscriptionId: string;
    resourceGroup: string;
    tenantId: string;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [activePipelineRepo, setActivePipelineRepo] = useState<GitHubRepo | null>(null);
  const [resumeRepo, setResumeRepo] = useState<GitHubRepo | undefined>(undefined);

  // Resolve Azure context from cluster info
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

  // Check for an in-progress pipeline
  const checkActivePipeline = useCallback(() => {
    const cluster = project.clusters?.[0];
    const ns = project.namespaces?.[0];
    if (!cluster || !ns) {
      setActivePipelineRepo(null);
      return;
    }
    const active = getActivePipeline(cluster, ns);
    setActivePipelineRepo(active?.repo ?? null);
  }, [project.clusters, project.namespaces]);

  useEffect(() => {
    checkActivePipeline();
  }, [checkActivePipeline]);

  const handleOpen = () => {
    setResumeRepo(undefined);
    setOpen(true);
  };

  const handleResumeClick = () => {
    if (activePipelineRepo) {
      setResumeRepo(activePipelineRepo);
      setOpen(true);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setResumeRepo(undefined);
    checkActivePipeline();
  };

  const cluster = project.clusters?.[0] || '';
  const namespace = project.namespaces?.[0] || '';

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          variant="outlined"
          startIcon={<Icon icon="mdi:github" />}
          onClick={handleOpen}
          sx={{ textTransform: 'none', fontWeight: 'bold' }}
        >
          Configure Pipeline
        </Button>
        {activePipelineRepo && (
          <Button
            variant="outlined"
            color="info"
            size="small"
            startIcon={<Icon icon="mdi:progress-clock" />}
            onClick={handleResumeClick}
            sx={{ textTransform: 'none', fontWeight: 500, fontSize: '0.8rem' }}
          >
            Pipeline in progress
          </Button>
        )}
      </Box>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { height: '90vh', maxHeight: '90vh' } }}
      >
        {azureContext ? (
          <GitHubPipelineWizard
            clusterName={cluster}
            namespace={namespace}
            appName=""
            subscriptionId={azureContext.subscriptionId}
            resourceGroup={azureContext.resourceGroup}
            tenantId={azureContext.tenantId}
            onClose={handleClose}
            initialRepo={resumeRepo}
            mode="configure"
          />
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
            Loading Azure context...
          </Box>
        )}
      </Dialog>
    </>
  );
}

export default ConfigurePipelineButton;
