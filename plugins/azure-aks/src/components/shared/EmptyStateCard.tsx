// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Card, Typography } from '@mui/material';
import React from 'react';

/** Props for {@link EmptyStateCard}. */
export interface EmptyStateCardProps {
  /** Primary message text. */
  message: string;
  /** Typography variants for the primary message. */
  messageVariant?: 'h6' | 'body1';
  /** Optional secondary messages displayed below the primary message. */
  subMessages?: string[];
}

/**
 *  Empty card indicating no data is available.
 */
export const EmptyStateCard: React.FC<EmptyStateCardProps> = ({
  message,
  messageVariant = 'h6',
  subMessages,
}) => {
  return (
    <Card sx={{ p: 4, textAlign: 'center' }}>
      <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center">
        <Icon
          icon="mdi:chart-box-outline"
          style={{ marginBottom: 16, color: '#ccc', fontSize: 64 }}
        />
        <Typography
          variant={messageVariant}
          color="textSecondary"
          gutterBottom={messageVariant === 'h6'}
        >
          {message}
        </Typography>
        {subMessages?.map((msg, idx) => (
          <Typography key={idx} color="textSecondary" variant="body2">
            {msg}
          </Typography>
        ))}
      </Box>
    </Card>
  );
};
