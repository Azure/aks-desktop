// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Button, Dialog } from '@mui/material';
import React, { useEffect, useRef } from 'react';
import { useAzureContext } from '../../hooks/useAzureContext';
import { useNamespaceCapabilities } from '../../hooks/useNamespaceCapabilities';
import { trackFeature } from '../../telemetry';
import DeployWizard from '../DeployWizard/DeployWizard';
import { useDeployUrlParams } from './hooks/useDeployUrlParams';
import { useDialogState } from './hooks/useDialogState';

function safelyTrackDeployOpened() {
  try {
    trackFeature({ feature: 'aksd.deploy', status: 'opened' });
  } catch {}
}

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

interface DeployDialogContentProps {
  cluster?: string;
  namespace?: string;
  initialApplicationName?: string;
  onClose: () => void;
}

function DeployDialogContent({
  cluster,
  namespace,
  initialApplicationName,
  onClose,
}: DeployDialogContentProps) {
  const { azureContext, error: azureContextError } = useAzureContext(cluster);
  const { isManagedNamespace, azureRbacEnabled } = useNamespaceCapabilities({
    subscriptionId: azureContext?.subscriptionId,
    resourceGroup: azureContext?.resourceGroup,
    clusterName: cluster,
    namespace: namespace ?? 'default',
  });

  return (
    <DeployWizard
      cluster={cluster}
      namespace={namespace}
      initialApplicationName={initialApplicationName}
      onClose={onClose}
      azureContext={
        azureContext && cluster
          ? {
              subscriptionId: azureContext.subscriptionId,
              resourceGroup: azureContext.resourceGroup,
              clusterName: cluster,
              isManagedNamespace,
              azureRbacEnabled,
            }
          : undefined
      }
      azureContextError={azureContextError ?? undefined}
    />
  );
}

/**
 * Renders a button that opens the deploy wizard dialog.
 *
 * @param props.project - The project whose first cluster and namespace are passed to the wizard.
 */
function DeployButton({ project }: DeployButtonProps) {
  const { t } = useTranslation();
  const urlParams = useDeployUrlParams();
  const dialogState = useDialogState();
  const handledUrlOpenRef = useRef(false);
  const cluster = project.clusters?.[0] || undefined;
  const namespace = project.namespaces?.[0] || undefined;

  // Open dialog when URL parameters indicate we should
  useEffect(() => {
    if (!urlParams.shouldOpenDialog) {
      handledUrlOpenRef.current = false;
      return;
    }

    if (handledUrlOpenRef.current) return;
    handledUrlOpenRef.current = true;
    safelyTrackDeployOpened();
    dialogState.openDialog(urlParams.initialApplicationName);
    urlParams.clearUrlTrigger();
  }, [
    urlParams.shouldOpenDialog,
    urlParams.initialApplicationName,
    urlParams.clearUrlTrigger,
    dialogState.openDialog,
  ]);

  const handleClickOpen = () => {
    safelyTrackDeployOpened();
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
        {t('Deploy Application')}
      </Button>
      <Dialog
        open={dialogState.open}
        onClose={handleClose}
        maxWidth="lg"
        fullWidth
        aria-labelledby="deploy-wizard-dialog-title"
        PaperProps={{
          sx: {
            height: '90vh',
            maxHeight: '90vh',
          },
        }}
      >
        {dialogState.open && (
          <DeployDialogContent
            cluster={cluster}
            namespace={namespace}
            initialApplicationName={dialogState.initialApplicationName}
            onClose={handleClose}
          />
        )}
      </Dialog>
    </>
  );
}

export default DeployButton;
