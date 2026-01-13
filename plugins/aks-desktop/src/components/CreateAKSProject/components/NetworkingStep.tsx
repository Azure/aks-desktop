// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { TextField } from '@mui/material';
import { Box, MenuItem, Typography } from '@mui/material';
import React from 'react';
import type { NetworkingStepProps } from '../types';
import { EGRESS_OPTIONS, INGRESS_OPTIONS } from '../types';

/**
 * Networking step component for ingress and egress policy configuration
 */
export const NetworkingStep: React.FC<NetworkingStepProps> = ({
  formData,
  onFormDataChange,
  loading = false,
}) => {
  const handleInputChange = (field: string, value: any) => {
    onFormDataChange({ [field]: value });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          Networking Policies
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Set security, communication and access rules for incoming and outgoing traffic
        </Typography>
      </Box>
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
            {option.label}
          </MenuItem>
        ))}
      </TextField>

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
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    </Box>
  );
};
