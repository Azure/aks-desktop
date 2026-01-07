// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Button, Dialog } from '@mui/material';
import React, { useEffect } from 'react';
import DeployWizard from '../DeployWizard/DeployWizard';
import { useDeployUrlParams } from './hooks/useDeployUrlParams';
import { useDialogState } from './hooks/useDialogState';

export interface ProjectDefinition {
  id: string;
  namespaces: string[];
  clusters: string[];
}

type Project = ProjectDefinition;

interface DeployButtonProps {
  project: Project;
}

/**
 * DeployButton component - Triggers the deploy wizard dialog
 */
function DeployButton({ project }: DeployButtonProps) {
  const urlParams = useDeployUrlParams();
  const dialogState = useDialogState();

  // Open dialog when URL parameters indicate we should
  useEffect(() => {
    if (urlParams.shouldOpenDialog) {
      dialogState.openDialog(urlParams.initialApplicationName);
      urlParams.clearUrlTrigger();
    }
  }, [urlParams.shouldOpenDialog, urlParams.clearUrlTrigger, dialogState.openDialog]);

  const handleClickOpen = () => {
    dialogState.openDialog();
  };

  const handleClose = () => {
    dialogState.closeDialog();
  };

  return (
    <>
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
          onClose={handleClose}
        />
      </Dialog>
    </>
  );
}

export default DeployButton;
