// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Typography } from '@mui/material';
import React from 'react';

export interface ResourceCardProps {
  title: string;
  icon: string;
  iconColor: string;
  children: React.ReactNode;
}

/**
 * Resource card component for displaying CPU/Memory configuration
 */
export const ResourceCard: React.FC<ResourceCardProps> = ({ title, icon, iconColor, children }) => {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        {/* aria-hidden: decorative icon — the adjacent heading already conveys the
            section name to screen readers. Hiding it prevents duplicate announcements.
            MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden */}
        <Icon
          icon={icon}
          width={24}
          height={24}
          color={iconColor}
          style={{ marginRight: 12 }}
          aria-hidden="true"
        />
        <Typography variant="h6" component="h3" sx={{ fontWeight: 'bold' }}>
          {title}
        </Typography>
      </Box>
      {children}
    </Box>
  );
};
