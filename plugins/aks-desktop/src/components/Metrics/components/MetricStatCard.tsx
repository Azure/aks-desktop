// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Typography, useTheme } from '@mui/material';
import React from 'react';

/** Props for {@link MetricStatCard}. */
export interface MetricStatCardProps {
  /** MDI Icon identifier (ex. "mdi:memory"). */
  icon: string;
  /** Color for the icon. */
  iconColor: string;
  /** Label shown above the metric value. */
  label: string;
  /** Formatted metric value to display. */
  value: string;
}

/** A single metric stat box with icon, label, and value. */
export const MetricStatCard: React.FC<MetricStatCardProps> = ({
  icon,
  iconColor,
  label,
  value,
}) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 1,
        // @ts-ignore todo: fix palette type so background.muted is recognized
        background: theme.palette.background.muted,
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      <Box display="flex" alignItems="center" mb={1}>
        <Icon icon={icon} style={{ fontSize: 24, marginRight: 8, color: iconColor }} />
        <Typography variant="caption" color="textSecondary">
          {label}
        </Typography>
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
        {value}
      </Typography>
    </Box>
  );
};
