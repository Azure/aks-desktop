// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Alert, AlertTitle, Box } from '@mui/material';
import React from 'react';
import type { ValidationAlertProps } from '../types';

/**
 * Reusable validation alert component
 * Displays error, warning, success, or info messages with optional actions
 */
export const ValidationAlert: React.FC<ValidationAlertProps> = ({
  type,
  message,
  onClose,
  action,
  show = true,
}) => {
  if (!show) {
    return null;
  }

  return (
    <Box mb={2}>
      <Alert
        severity={type}
        onClose={onClose}
        action={action}
        sx={{
          '& .MuiAlert-message': {
            width: '100%',
          },
        }}
      >
        {typeof message === 'string' ? <AlertTitle>{message}</AlertTitle> : message}
      </Alert>
    </Box>
  );
};
