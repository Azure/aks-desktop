// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import React from 'react';
import type { ProjectDefinition } from '../AKSProjectDeleteButton';

export interface AKSProjectDeleteDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog is dismissed without deleting. */
  onClose: () => void;
  /** The project to delete. */
  project: ProjectDefinition;
  /** Whether the user has opted to also delete the namespaces. */
  deleteNamespaces: boolean;
  /** Toggles the `deleteNamespaces` option. */
  setDeleteNamespaces: (value: boolean) => void;
  /** Called when the user confirms deletion. */
  onDelete: () => void;
}

export const AKSProjectDeleteDialog: React.FC<AKSProjectDeleteDialogProps> = ({
  open,
  onClose,
  project,
  deleteNamespaces,
  setDeleteNamespaces,
  onDelete,
}) => {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="project-delete-dialog-title"
      aria-describedby="project-delete-dialog-description"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle id="project-delete-dialog-title">{t('Delete Project')}</DialogTitle>
      <DialogContent>
        <DialogContentText id="project-delete-dialog-description" component="div">
          <Typography variant="body1" paragraph>
            {t('Are you sure you want to delete project "{{projectId}}"?', {
              projectId: project.id,
            })}
          </Typography>

          <Typography variant="body2" paragraph>
            {t(
              'By default, this will remove the Azure managed namespace and project labels from the following namespaces:'
            )}
          </Typography>

          <List dense>
            {project.namespaces.map(ns => (
              <ListItem key={ns}>
                <ListItemText primary={ns} primaryTypographyProps={{ fontWeight: 'bold' }} />
              </ListItem>
            ))}
          </List>

          <FormControlLabel
            control={
              <Checkbox
                checked={deleteNamespaces}
                onChange={e => setDeleteNamespaces(e.target.checked)}
                name="deleteNamespaces"
                color="primary"
              />
            }
            label={
              <Typography variant="body2">
                {t('Also delete the namespaces (this will remove all resources within them)')}
              </Typography>
            }
          />

          {deleteNamespaces && (
            <Typography variant="body2" color="error" sx={{ mt: 1, fontWeight: 'bold' }}>
              {t(
                'Warning: This action cannot be undone. All resources in these namespaces will be permanently deleted.'
              )}
            </Typography>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {t(
              'Note: For AKS managed namespaces, Azure ARM management will be removed automatically.'
            )}
          </Typography>
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="secondary" variant="contained">
          {t('Cancel')}
        </Button>
        <Button onClick={onDelete} color="primary" variant="contained" sx={{ minWidth: '200px' }}>
          {deleteNamespaces ? t('Delete Project & Namespaces') : t('Delete Project')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
