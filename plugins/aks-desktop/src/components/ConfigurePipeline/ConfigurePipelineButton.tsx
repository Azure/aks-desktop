// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, Drawer } from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { useAzureContext } from '../../hooks/useAzureContext';
import { usePreviewFeatures } from '../../hooks/usePreviewFeatures';
import type { ProjectDefinition } from '../../types/project';
import { usePipelineStatus } from '../DeployTab/hooks/usePipelineStatus';
import { OPEN_CONFIGURE_PIPELINE_EVENT } from '../GitHubPipeline/constants';
import { GitHubPipelineWizard } from '../GitHubPipeline/GitHubPipelineWizard';
import { clearActivePipeline } from '../GitHubPipeline/utils/pipelineStorage';

interface ConfigurePipelineButtonProps {
  project: ProjectDefinition;
  setSelectedTab?: (tabId: string) => void;
}

function ConfigurePipelineButton({ project, setSelectedTab }: ConfigurePipelineButtonProps) {
  const { t } = useTranslation();
  const { githubPipelines } = usePreviewFeatures();
  const { azureContext, error: azureContextError } = useAzureContext(project.clusters?.[0]);
  const [open, setOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);
  const [startedOver, setStartedOver] = useState(false);

  const cluster = project.clusters?.[0] ?? '';
  const namespace = project.namespaces?.[0] ?? '';
  const pipelineStatus = usePipelineStatus(cluster, namespace);

  // Listen for custom event from PipelineCard (separate React tree)
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_CONFIGURE_PIPELINE_EVENT, handler);
    return () => window.removeEventListener(OPEN_CONFIGURE_PIPELINE_EVENT, handler);
  }, []);

  if (!githubPipelines) return null;

  const handleClose = () => {
    setOpen(false);
  };

  const handleStartOver = () => {
    clearActivePipeline(cluster, namespace);
    setStartedOver(true);
    setOpen(false);
    setWizardKey(k => k + 1);
  };

  const handleViewDeployment = useCallback(() => {
    setOpen(false);
    setSelectedTab?.('deploy');
  }, [setSelectedTab]);

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        startIcon={<Icon icon="mdi:pipe" aria-hidden="true" />}
        onClick={() => setOpen(true)}
        sx={{ textTransform: 'none', fontWeight: 'bold' }}
      >
        {t('Configure Pipeline')}
      </Button>
      <Drawer
        anchor="right"
        open={open}
        onClose={handleClose}
        sx={{ zIndex: theme => theme.zIndex.drawer + 2 }}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 480, md: 560, lg: 640 },
            maxWidth: '100vw',
          },
        }}
      >
        {azureContext ? (
          <GitHubPipelineWizard
            key={wizardKey}
            clusterName={cluster}
            namespace={namespace}
            subscriptionId={azureContext.subscriptionId}
            resourceGroup={azureContext.resourceGroup}
            tenantId={azureContext.tenantId}
            onClose={handleClose}
            onCancel={handleStartOver}
            onViewDeployment={setSelectedTab ? handleViewDeployment : undefined}
            initialRepo={
              !startedOver && pipelineStatus.isConfigured ? pipelineStatus.repos[0] : undefined
            }
            mode="configure"
            projectName={project.id}
          />
        ) : azureContextError ? (
          <Box sx={{ p: 3 }}>
            <Alert severity="error">{azureContextError}</Alert>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
            {t('Loading Azure context...')}
          </Box>
        )}
      </Drawer>
    </>
  );
}

export default ConfigurePipelineButton;
