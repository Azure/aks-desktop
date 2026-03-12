// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Grid, Typography } from '@mui/material';
import React from 'react';
import type {
  ChartDataPoint,
  MemoryUnit,
  NetworkDataPoint,
  RequestErrorDataPoint,
  ResponseTimeDataPoint,
} from '../utils';
import { MetricsChart } from './MetricsChart';

/** Props for {@link MetricsChartsGrid}. */
export interface MetricsChartsGridProps {
  /** CPU usage data points. */
  cpuData: ChartDataPoint[];
  /** Memory usage data points. */
  memoryData: ChartDataPoint[];
  /** Request and error rate data points. */
  requestErrorData: RequestErrorDataPoint[];
  /** Response time data points. */
  responseTimeData: ResponseTimeDataPoint[];
  /** Network usage data points. */
  networkData: NetworkDataPoint[];
  /** Unit for memory usage data. */
  memoryUnit: MemoryUnit;
}

/** Grid of five metric charts with corresponding section headings. */
export const MetricsChartsGrid: React.FC<MetricsChartsGridProps> = ({
  cpuData,
  memoryData,
  requestErrorData,
  responseTimeData,
  networkData,
  memoryUnit,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Request/Error and Response Time (2 charts) */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <MetricsChart
            title={t('Request & error rate')}
            data={requestErrorData}
            yAxisLabel={t('Rate')}
            lines={[
              { dataKey: 'requestRate', stroke: '#4caf50', name: t('Request Rate') },
              { dataKey: 'errorRate', stroke: '#f44336', name: t('Error Rate') },
            ]}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <MetricsChart
            title={t('Response Time')}
            data={responseTimeData}
            yAxisLabel="ms"
            lines={[{ dataKey: 'responseTime', stroke: '#9c27b0', name: t('Avg Response Time') }]}
            emptyMessage={t('No response time data available')}
          />
        </Grid>
      </Grid>

      {/* Resource Usage (2 charts) */}
      <Typography variant="h6" sx={{ mb: 2, mt: 3 }}>
        {t('Resource Usage')}
      </Typography>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <MetricsChart
            title={t('CPU Usage')}
            data={cpuData}
            yAxisLabel={t('Cores')}
            lines={[{ dataKey: 'value', stroke: '#2196f3', name: t('Absolute usage') }]}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <MetricsChart
            title={t('Memory utilization')}
            data={memoryData}
            yAxisLabel={memoryUnit}
            lines={[{ dataKey: 'value', stroke: '#ff9800', name: t('Absolute usage') }]}
          />
        </Grid>
      </Grid>

      {/* Network Usage (1 chart) */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <MetricsChart
            title={t('Network I/O')}
            data={networkData}
            yAxisLabel="KB/s"
            lines={[
              { dataKey: 'networkIn', stroke: '#9c27b0', name: t('Network In') },
              { dataKey: 'networkOut', stroke: '#e91e63', name: t('Network Out') },
            ]}
          />
        </Grid>
      </Grid>
    </>
  );
};
