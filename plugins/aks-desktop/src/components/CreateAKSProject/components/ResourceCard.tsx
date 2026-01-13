// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Typography } from '@mui/material';
import React from 'react';
import type { ResourceCardProps } from '../types';

/**
 * Resource card component for displaying CPU/Memory configuration
 */
export const ResourceCard: React.FC<ResourceCardProps> = ({ title, icon, iconColor, children }) => {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Icon icon={icon} width={24} height={24} color={iconColor} style={{ marginRight: 12 }} />
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          {title}
        </Typography>
      </Box>
      {children}
    </Box>
  );
};
