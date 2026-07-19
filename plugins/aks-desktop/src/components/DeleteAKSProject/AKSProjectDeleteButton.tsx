// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { IconButton, Tooltip } from '@mui/material';
import React, { useState } from 'react';
import { trackAksFeature } from '../../telemetry/aksFeature';
import { AKSProjectDeleteDialog } from './components/AKSProjectDeleteDialog';
import { useProjectDeletion } from './hooks/useProjectDeletion';
import { useProjectPermissions } from './hooks/useProjectPermissions';

export interface ProjectDefinition {
  id: string;
  namespaces: string[];
  clusters: string[];
}

export interface AKSProjectDeleteButtonProps {
  project: ProjectDefinition;
}

const AKSProjectDeleteButton: React.FC<AKSProjectDeleteButtonProps> = ({ project }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [deleteNamespaces, setDeleteNamespaces] = useState(false);

  const { isLoading, canDelete } = useProjectPermissions(project);
  const { handleDelete } = useProjectDeletion();

  const handleOpen = () => {
    trackAksFeature('aksd.project-delete', 'opened');
    setOpen(true);
  };

  const handleCancel = () => {
    trackAksFeature('aksd.project-delete', 'cancelled');
    setOpen(false);
  };

  if (isLoading) {
    return (
      <Tooltip title={t('Delete project')}>
        <IconButton aria-label={t('Delete project')} size="medium">
          <Icon icon="mdi:delete" />
        </IconButton>
      </Tooltip>
    );
  }

  if (!canDelete) {
    return null;
  }

  return (
    <>
      <Tooltip title={t('Delete project')}>
        <IconButton aria-label={t('Delete project')} onClick={handleOpen} size="medium">
          <Icon icon="mdi:delete" />
        </IconButton>
      </Tooltip>

      <AKSProjectDeleteDialog
        open={open}
        onClose={handleCancel}
        project={project}
        deleteNamespaces={deleteNamespaces}
        setDeleteNamespaces={setDeleteNamespaces}
        onDelete={() => handleDelete(project, deleteNamespaces, () => setOpen(false))}
      />
    </>
  );
};

export default AKSProjectDeleteButton;
