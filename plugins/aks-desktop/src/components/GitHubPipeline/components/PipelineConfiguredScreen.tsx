// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Button, Typography } from '@mui/material';
import React from 'react';

interface PipelineConfiguredScreenProps {
  repoFullName: string;
  onClose: () => void;
}

export const PipelineConfiguredScreen: React.FC<PipelineConfiguredScreenProps> = ({
  repoFullName,
  onClose,
}) => (
  <Box sx={{ textAlign: 'center', py: 6 }}>
    <Icon icon="mdi:check-circle" style={{ fontSize: 64, color: '#4caf50', marginBottom: 16 }} />
    <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
      Pipeline Configured
    </Typography>
    <Typography variant="body1" sx={{ color: 'text.secondary', mb: 4, maxWidth: 480, mx: 'auto' }}>
      CI/CD pipeline for <strong>{repoFullName}</strong> is ready. Deploy to specific clusters from
      the Deploy tab.
    </Typography>
    <Button variant="contained" onClick={onClose}>
      Done
    </Button>
  </Box>
);
