// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Grid, Typography } from '@mui/material';
import React from 'react';
import type { ComputeStepProps } from '../types';
import { FormField } from './FormField';
import { ResourceCard } from './ResourceCard';

/**
 * Compute step component for CPU and memory quota configuration
 */
export const ComputeStep: React.FC<ComputeStepProps> = ({
  formData,
  onFormDataChange,
  validation,
  loading = false,
}) => {
  const handleInputChange = (field: string, value: number) => {
    onFormDataChange({ [field]: value });
  };

  // Extract field-specific validation errors
  const getFieldError = (fieldName: string): string | undefined => {
    const fieldErrors = validation.fieldErrors?.[fieldName];
    return fieldErrors && fieldErrors.length > 0 ? fieldErrors[0] : undefined;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          Compute Quota
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Set quota limits to prevent overuse and maintain cluster stability
        </Typography>
      </Box>
      {/* CPU Section */}
      <ResourceCard title="CPU Resources" icon="mdi:cpu-64-bit" iconColor="#1976d2">
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <FormField
              label="CPU Requests"
              type="number"
              value={formData.cpuRequest}
              onChange={value => handleInputChange('cpuRequest', value as number)}
              disabled={loading}
              helperText={
                getFieldError('cpuRequest') || 'Minimum CPU guaranteed (1000m = 1 CPU core)'
              }
              error={!!getFieldError('cpuRequest')}
              startAdornment={
                <Icon
                  icon="mdi:arrow-down"
                  width={20}
                  height={20}
                  color="#4caf50"
                  style={{ marginRight: 8 }}
                />
              }
              endAdornment={
                <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                  millicores
                </Typography>
              }
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <FormField
              label="CPU Limits"
              type="number"
              value={formData.cpuLimit}
              onChange={value => handleInputChange('cpuLimit', value as number)}
              disabled={loading}
              helperText={getFieldError('cpuLimit') || 'Maximum CPU allowed (1000m = 1 CPU core)'}
              error={!!getFieldError('cpuLimit')}
              startAdornment={
                <Icon
                  icon="mdi:arrow-up"
                  width={20}
                  height={20}
                  color="#f44336"
                  style={{ marginRight: 8 }}
                />
              }
              endAdornment={
                <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                  millicores
                </Typography>
              }
            />
          </Grid>
        </Grid>
      </ResourceCard>

      {/* Memory Section */}
      <ResourceCard title="Memory Resources" icon="mdi:memory" iconColor="#9c27b0">
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <FormField
              label="Memory Requests"
              type="number"
              value={formData.memoryRequest}
              onChange={value => handleInputChange('memoryRequest', value as number)}
              disabled={loading}
              helperText={
                getFieldError('memoryRequest') || 'Minimum memory guaranteed (1024 MiB = 1 GiB)'
              }
              error={!!getFieldError('memoryRequest')}
              startAdornment={
                <Icon
                  icon="mdi:arrow-down"
                  width={20}
                  height={20}
                  color="#4caf50"
                  style={{ marginRight: 8 }}
                />
              }
              endAdornment={
                <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                  MiB
                </Typography>
              }
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <FormField
              label="Memory Limits"
              type="number"
              value={formData.memoryLimit}
              onChange={value => handleInputChange('memoryLimit', value as number)}
              disabled={loading}
              helperText={
                getFieldError('memoryLimit') || 'Maximum memory allowed (1024 MiB = 1 GiB)'
              }
              error={!!getFieldError('memoryLimit')}
              startAdornment={
                <Icon
                  icon="mdi:arrow-up"
                  width={20}
                  height={20}
                  color="#f44336"
                  style={{ marginRight: 8 }}
                />
              }
              endAdornment={
                <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                  MiB
                </Typography>
              }
            />
          </Grid>
        </Grid>
      </ResourceCard>
    </Box>
  );
};
