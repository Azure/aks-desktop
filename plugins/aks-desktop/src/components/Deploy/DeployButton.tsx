// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Button, Dialog } from '@mui/material';
import React, { useEffect } from 'react';
import DeployWizard from '../DeployWizard/DeployWizard';
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
