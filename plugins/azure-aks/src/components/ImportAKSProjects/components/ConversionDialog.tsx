// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from '@mui/material';
import React from 'react';
import type { DiscoveredNamespace } from '../../../hooks/useNamespaceDiscovery';
import {
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../../../utils/constants/projectLabels';

type NamespaceInfo = Pick<DiscoveredNamespace, 'name' | 'clusterName' | 'isManagedNamespace'>;

interface ConversionDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  namespacesToConvert: NamespaceInfo[];
  namespacesToImport: NamespaceInfo[];
  converting: boolean;
}

export function ConversionDialog({
  open,
  onClose,
  onConfirm,
  namespacesToConvert,
  namespacesToImport,
  converting,
}: ConversionDialogProps) {
  const { t } = useTranslation();

  const hasManagedNamespaces = namespacesToConvert.some(ns => ns.isManagedNamespace);

  return (
    <Dialog
      open={open}
      onClose={() => !converting && onClose()}
      aria-labelledby="conversion-dialog-title"
      aria-describedby="conversion-dialog-description"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle id="conversion-dialog-title">
        {t('Convert Namespaces to AKS Projects')}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="conversion-dialog-description" component="div">
          <Typography variant="body1" paragraph>
            {t(
              'The following namespaces will be converted to AKS Desktop projects by adding these labels:'
            )}
          </Typography>

          <Box
            sx={{
              backgroundColor: 'action.hover',
              borderRadius: 1,
              px: 2,
              py: 1,
              mb: 2,
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            <div>{PROJECT_ID_LABEL}: &lt;namespace-name&gt;</div>
            <div>
              {PROJECT_MANAGED_BY_LABEL}: {PROJECT_MANAGED_BY_VALUE}
            </div>
            {hasManagedNamespaces && (
              <>
                <div>
                  {SUBSCRIPTION_LABEL}: &lt;subscription-id&gt;{' '}
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ fontFamily: 'inherit', opacity: 0.7 }}
                  >
                    ({t('managed namespaces only')})
                  </Typography>
                </div>
                <div>
                  {RESOURCE_GROUP_LABEL}: &lt;resource-group&gt;{' '}
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ fontFamily: 'inherit', opacity: 0.7 }}
                  >
                    ({t('managed namespaces only')})
                  </Typography>
                </div>
              </>
            )}
          </Box>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('Namespaces to convert:')}
          </Typography>
          <Box component="ul" sx={{ mt: 0, mb: 2 }}>
            {namespacesToConvert.map(ns => (
              <li key={`${ns.clusterName}/${ns.name}`}>
                <strong>{ns.name}</strong> ({ns.clusterName})
              </li>
            ))}
          </Box>

          {namespacesToImport.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('Already AKS projects (will import directly):')}
              </Typography>
              <Box component="ul" sx={{ mt: 0, mb: 0 }}>
                {namespacesToImport.map(ns => (
                  <li key={`${ns.clusterName}/${ns.name}`}>
                    <strong>{ns.name}</strong> ({ns.clusterName})
                  </li>
                ))}
              </Box>
            </>
          )}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="secondary" variant="contained" disabled={converting}>
          {t('Cancel')}
        </Button>
        <Button
          onClick={onConfirm}
          color="primary"
          variant="contained"
          disabled={converting}
          startIcon={converting ? <CircularProgress size={20} /> : undefined}
          sx={{ minWidth: '200px' }}
        >
          {converting ? `${t('Converting')}...` : t('Confirm & Import')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
