// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Card, Typography } from '@mui/material';
import React from 'react';
import type { MetricSummary } from '../utils';

/** Props for {@link MetricsSummaryBar}. */
export interface MetricsSummaryBarProps {
  /**
   * Aggregated summary of metrics displayed in the summary bar.
   * @see {@link MetricSummary}
   */
  summary: MetricSummary;
}

/** Card row that displays latest fetched values for key metrics. */
export const MetricsSummaryBar: React.FC<MetricsSummaryBarProps> = ({ summary }) => {
  const { t } = useTranslation();

  return (
    <Card sx={{ p: 2, mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        {t('Application Metrics')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: '100px' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('Project Status')}
          </Typography>
          <Typography
            variant="body1"
            fontWeight="bold"
            sx={{
              color: summary.projectStatus === 'Healthy' ? 'success.main' : 'warning.main',
            }}
          >
            {summary.projectStatus}
          </Typography>
        </Box>
        <Box sx={{ minWidth: '80px' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('Total Pods')}
          </Typography>
          <Typography variant="body1" fontWeight="bold">
            {summary.totalPods}
          </Typography>
        </Box>
        <Box sx={{ minWidth: '100px' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('Request Rate')}
          </Typography>
          <Typography variant="body1" fontWeight="bold" sx={{ color: 'success.main' }}>
            {summary.requestRate}
          </Typography>
        </Box>
        <Box sx={{ minWidth: '80px' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('Error Rate')}
          </Typography>
          <Typography variant="body1" fontWeight="bold" sx={{ color: 'error.main' }}>
            {summary.errorRate}
          </Typography>
        </Box>
        <Box sx={{ minWidth: '100px' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('CPU Usage')}
          </Typography>
          <Typography variant="body1" fontWeight="bold">
            {summary.cpuUsage}
          </Typography>
        </Box>
        <Box sx={{ minWidth: '100px' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('Memory Usage')}
          </Typography>
          <Typography variant="body1" fontWeight="bold">
            {summary.memoryUsage}
          </Typography>
        </Box>
      </Box>
    </Card>
  );
};
