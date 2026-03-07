// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Typography } from '@mui/material';
import React from 'react';

interface PipelineConfiguredScreenProps {
  repoFullName: string;
}

export function PipelineConfiguredScreen({ repoFullName }: PipelineConfiguredScreenProps) {
  return (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <Box
        component={Icon}
        icon="mdi:check-circle"
        sx={{ fontSize: 64, color: 'success.main', mb: 2 }}
      />
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
        Pipeline Configured
      </Typography>
      <Typography variant="body1" sx={{ color: 'text.secondary' }}>
        CI/CD pipeline for <strong>{repoFullName}</strong> is ready. Trigger deployments from the
        Deploy tab.
      </Typography>
    </Box>
  );
}
