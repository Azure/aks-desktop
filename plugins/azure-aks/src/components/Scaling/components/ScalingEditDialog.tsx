// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import React from 'react';
import type { EditValues } from '../hooks/useEditDialog';
import type { HPAInfo } from '../hooks/useHPAInfo';

/**
 * Props for the {@link ScalingEditDialog} component.
 */
interface ScalingEditDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Current HPA state, or null if the deployment is not HPA-managed. */
  hpaInfo: HPAInfo | null;
  /** Current form values. */
  editValues: EditValues;
  /** Whether a save request is in flight. */
  saving: boolean;
  /** Callback to update form values. */
  onEditValuesChange: React.Dispatch<React.SetStateAction<EditValues>>;
  /** Callback to close the dialog without saving. */
  onClose: () => void;
  /** Callback to persist the current form values. */
  onSave: () => Promise<void>;
}

/**
 * Modal dialog for editing HPA or manual scaling configuration.
 *
 * Renders different fields depending on whether an HPA is active:
 * - HPA mode: min replicas, max replicas, target CPU utilization
 * - Manual mode: desired replica count
 */
export const ScalingEditDialog: React.FC<ScalingEditDialogProps> = ({
  open,
  hpaInfo,
  editValues,
  saving,
  onEditValuesChange,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {hpaInfo ? t('Edit HPA Configuration') : t('Edit Manual Scaling Configuration')}
      </DialogTitle>
      <DialogContent>
        {hpaInfo ? (
          <>
            <TextField
              label={t('Minimum Replicas')}
              type="number"
              fullWidth
              value={editValues.minReplicas}
              onChange={e =>
                onEditValuesChange(v => {
                  const n = parseInt(e.target.value, 10);
                  return { ...v, minReplicas: Number.isFinite(n) ? n : v.minReplicas };
                })
              }
              sx={{ mt: 2, mb: 2 }}
              inputProps={{ min: 1 }}
            />
            <TextField
              label={t('Maximum Replicas')}
              type="number"
              fullWidth
              value={editValues.maxReplicas}
              onChange={e =>
                onEditValuesChange(v => {
                  const n = parseInt(e.target.value, 10);
                  return { ...v, maxReplicas: Number.isFinite(n) ? n : v.maxReplicas };
                })
              }
              sx={{ mb: 2 }}
              inputProps={{ min: editValues.minReplicas }}
            />
            <TextField
              label={t('Target CPU Utilization (%)')}
              type="number"
              fullWidth
              value={editValues.targetCPU}
              onChange={e =>
                onEditValuesChange(v => {
                  const n = parseInt(e.target.value, 10);
                  return { ...v, targetCPU: Number.isFinite(n) ? n : v.targetCPU };
                })
              }
              inputProps={{ min: 1, max: 100 }}
            />
          </>
        ) : (
          <TextField
            label={t('Number of Replicas')}
            type="number"
            fullWidth
            value={editValues.replicas}
            onChange={e =>
              onEditValuesChange(v => {
                const n = parseInt(e.target.value, 10);
                return { ...v, replicas: Number.isFinite(n) ? n : v.replicas };
              })
            }
            sx={{ mt: 2 }}
            inputProps={{ min: 0 }}
            helperText={t('Set the desired number of pod replicas for this deployment')}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('Cancel')}
        </Button>
        <Button
          onClick={onSave}
          variant="contained"
          disabled={saving}
          startIcon={saving ? undefined : <Icon icon="mdi:content-save" />}
        >
          {saving ? <CircularProgress size={20} /> : t('Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
