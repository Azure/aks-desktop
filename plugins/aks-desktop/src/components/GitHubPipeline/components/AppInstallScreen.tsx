// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import React from 'react';

interface AppInstallScreenProps {
  owner: string;
  repo: string;
  installUrl: string | null;
  onCheckAgain: () => void;
  onCancel: () => void;
}

export const AppInstallScreen: React.FC<AppInstallScreenProps> = ({
  owner,
  repo,
  installUrl,
  onCheckAgain,
  onCancel,
}) => (
  <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
    <CardContent>
      <Box
        component={Icon}
        icon="mdi:puzzle-outline"
        sx={{ fontSize: 48, color: 'warning.main', mb: 2 }}
      />
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
        Install GitHub App
      </Typography>
      <Typography variant="body1" sx={{ mb: 3, color: 'text.secondary' }}>
        The AKS Desktop GitHub App must be installed on{' '}
        <strong>
          {owner}/{repo}
        </strong>{' '}
        to create deployment pipelines.
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
        {installUrl && (
          <Button variant="contained" onClick={() => window.open(installUrl, '_blank')}>
            Install GitHub App
          </Button>
        )}
        <Button variant="outlined" onClick={onCheckAgain}>
          Check Again
        </Button>
        <Button variant="text" onClick={onCancel}>
          Cancel
        </Button>
      </Box>
    </CardContent>
  </Card>
);
