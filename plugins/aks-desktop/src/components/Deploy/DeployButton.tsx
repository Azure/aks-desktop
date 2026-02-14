// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Button, Dialog } from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import type { GitHubRepo } from '../../types/github';
import { getClusterInfo } from '../../utils/azure/az-cli';
import DeployWizard from '../DeployWizard/DeployWizard';
import { getActivePipeline } from '../GitHubPipeline/hooks/useGitHubPipelineOrchestration';
import { useDeployUrlParams } from './hooks/useDeployUrlParams';
import { useDialogState } from './hooks/useDialogState';

/**
 * Defines the structure of a project for deployment.
 */
export interface ProjectDefinition {
  /** Unique identifier for the project. */
  id: string;
  /** List of Kubernetes namespaces associated with the project. */
  namespaces: string[];
  /** List of cluster names/identifiers where the project can be deployed. */
  clusters: string[];
}

/** Alias for ProjectDefinition. */
type Project = ProjectDefinition;

/**
 * Props for the {@link DeployButton} component.
 */
interface DeployButtonProps {
  /** The project containing cluster and namespace information for deployment. */
  project: Project;
}

/**
 * Renders a button that opens the deploy wizard dialog.
 *
 * @param props.project - The project whose first cluster and namespace are passed to the wizard.
 */
function DeployButton({ project }: DeployButtonProps) {
  const urlParams = useDeployUrlParams();
  const dialogState = useDialogState();
  const azureAuth = useAzureAuth();
  const [azureContext, setAzureContext] = useState<{
    subscriptionId: string;
    resourceGroup: string;
    tenantId: string;
  } | null>(null);
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

  // Check for an in-progress pipeline on mount and when the dialog closes
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

  // Open dialog when URL parameters indicate we should
  useEffect(() => {
    if (urlParams.shouldOpenDialog) {
      dialogState.openDialog(urlParams.initialApplicationName);
      urlParams.clearUrlTrigger();
    }
  }, [
    urlParams.shouldOpenDialog,
    urlParams.initialApplicationName,
    urlParams.clearUrlTrigger,
    dialogState.openDialog,
  ]);

  const handleClickOpen = () => {
    setResumeRepo(undefined);
    dialogState.openDialog();
  };

  const handleResumeClick = () => {
    if (activePipelineRepo) {
      setResumeRepo(activePipelineRepo);
      dialogState.openDialog();
    }
  };

  const handleClose = () => {
    dialogState.closeDialog();
    setResumeRepo(undefined);
    // Re-check active pipeline in case state changed while dialog was open
    checkActivePipeline();
  };

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          variant="contained"
          color="primary"
          startIcon={<Icon icon="mdi:cloud-upload" />}
          onClick={handleClickOpen}
          sx={{
            textTransform: 'none',
            fontWeight: 'bold',
          }}
        >
          Deploy Application
        </Button>
        {activePipelineRepo && (
          <Button
            variant="outlined"
            color="info"
            size="small"
            startIcon={<Icon icon="mdi:progress-clock" />}
            onClick={handleResumeClick}
            sx={{
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.8rem',
            }}
          >
            Pipeline in progress
          </Button>
        )}
      </Box>
      <Dialog
        open={dialogState.open}
        onClose={handleClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            height: '90vh',
            maxHeight: '90vh',
          },
        }}
      >
        <DeployWizard
          cluster={project.clusters?.[0] || undefined}
          namespace={project.namespaces?.[0] || undefined}
          initialApplicationName={dialogState.initialApplicationName}
          azureContext={azureContext ?? undefined}
          onClose={handleClose}
          resumePipelineRepo={resumeRepo}
        />
      </Dialog>
    </>
  );
}

export default DeployButton;
