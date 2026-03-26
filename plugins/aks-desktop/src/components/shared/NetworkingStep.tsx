// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Grid, MenuItem, TextField, Typography } from '@mui/material';
import React from 'react';
import type { NetworkingStepProps } from '../CreateAKSProject/types';

const INGRESS_OPTIONS = [
  { value: 'AllowSameNamespace', label: 'Allow traffic within same namespace' },
  { value: 'AllowAll', label: 'Allow all traffic' },
  { value: 'DenyAll', label: 'Deny all traffic' },
] as const;

const EGRESS_OPTIONS = [
  { value: 'AllowAll', label: 'Allow all traffic' },
  { value: 'AllowSameNamespace', label: 'Allow traffic within same namespace' },
  { value: 'DenyAll', label: 'Deny all traffic' },
] as const;

/**
 * Networking step component for ingress and egress policy configuration
 */
export const NetworkingStep: React.FC<NetworkingStepProps> = ({
  formData,
  onFormDataChange,
  loading = false,
}) => {
  const { t } = useTranslation();
  const handleInputChange = (field: string, value: any) => {
    onFormDataChange({ [field]: value });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          {t('Networking Policies')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('Set security, communication and access rules for incoming and outgoing traffic')}
        </Typography>
      </Box>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            variant="outlined"
            select
            value={formData.ingress}
            label="Ingress"
            onChange={e => handleInputChange('ingress', e.target.value)}
            disabled={loading}
          >
            {INGRESS_OPTIONS.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.value === 'AllowSameNamespace'
                  ? t('Allow traffic within same namespace')
                  : option.value === 'AllowAll'
                  ? t('Allow all traffic')
                  : t('Deny all traffic')}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            variant="outlined"
            select
            value={formData.egress}
            label="Egress"
            onChange={e => handleInputChange('egress', e.target.value)}
            disabled={loading}
          >
            {EGRESS_OPTIONS.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.value === 'AllowAll'
                  ? t('Allow all traffic')
                  : option.value === 'AllowSameNamespace'
                  ? t('Allow traffic within same namespace')
                  : t('Deny all traffic')}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
      </Grid>
    </Box>
  );
};
