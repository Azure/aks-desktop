// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, CircularProgress } from '@mui/material';
import React from 'react';

export type StepStatus = 'done' | 'active' | 'pending' | 'error';

interface StepStatusIconProps {
  status: StepStatus;
  size?: number;
}

/**
 * Renders an icon representing a step's status in a multi-step progress view.
 * - done: green check-circle
 * - active: spinning progress indicator
 * - pending: grey circle outline
 * - error: red close-circle
 */
export function StepStatusIcon({ status, size = 20 }: StepStatusIconProps) {
  if (status === 'done') {
    return (
      <Box sx={{ color: 'success.main', display: 'flex' }}>
        <Icon icon="mdi:check-circle" width={size} height={size} />
      </Box>
    );
  }
  if (status === 'error') {
    return (
      <Box sx={{ color: 'error.main', display: 'flex' }}>
        <Icon icon="mdi:close-circle" width={size} height={size} />
      </Box>
    );
  }
  if (status === 'active') {
    return <CircularProgress size={size - 2} />;
  }
  return (
    <Box sx={{ color: 'text.disabled', display: 'flex' }}>
      <Icon icon="mdi:circle-outline" width={size} height={size} />
    </Box>
  );
}
