// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Card, CircularProgress, Grid, Skeleton, Typography } from '@mui/material';
import React from 'react';

/** Skeleton placeholder shown while metrics data is loading. */
export const MetricsLoadingSkeleton: React.FC = () => {
  const { t } = useTranslation();

  return (
    <>
      {/* Loading Indicator */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          {t('Loading metrics')}...
        </Typography>
      </Box>

      {/* Loading Skeletons */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Card sx={{ p: 2 }}>
            <Skeleton variant="text" width={200} height={30} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" height={200} />
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card sx={{ p: 2 }}>
            <Skeleton variant="text" width={200} height={30} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" height={200} />
          </Card>
        </Grid>
      </Grid>
      <Typography variant="h6" sx={{ mb: 2, mt: 3 }}>
        {t('Resource Usage')}
      </Typography>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Card sx={{ p: 2 }}>
            <Skeleton variant="text" width={150} height={30} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" height={200} />
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card sx={{ p: 2 }}>
            <Skeleton variant="text" width={150} height={30} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" height={200} />
          </Card>
        </Grid>
      </Grid>
    </>
  );
};
