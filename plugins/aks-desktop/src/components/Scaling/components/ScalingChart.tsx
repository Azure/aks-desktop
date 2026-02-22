// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, AlertTitle, Box, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartDataPoint } from '../hooks/useChartData';

/** Custom XAxis tick renderer that displays labels at a -35° angle to prevent overlap. */
const AngledTick = ({
  x,
  y,
  payload,
}: {
  x: string | number;
  y: string | number;
  payload: { value: string };
}) => {
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="end" fill="#888" fontSize={9} transform="rotate(-35)">
        {payload.value}
      </text>
    </g>
  );
};

/** Props for the {@link ScalingChart} component. */
interface ScalingChartProps {
  /** Array of chart data points to render. */
  chartData: ChartDataPoint[];
  /** Whether the chart data is currently loading. */
  loading?: boolean;
  /** Error message to display, or null/undefined if no error. */
  error?: string | null;
}

/**
 * Displays the scaling metrics chart (replicas and CPU over time)
 */
export const ScalingChart: React.FC<ScalingChartProps> = ({ chartData, loading, error }) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        height="100%"
      >
        <CircularProgress size={32} sx={{ mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {t('Loading scaling metrics from Prometheus')}...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100%" p={2}>
        <Alert severity="warning" sx={{ maxWidth: 600 }}>
          <AlertTitle>Scaling Chart Unavailable</AlertTitle>
          <Typography variant="body2">{error}</Typography>
        </Alert>
      </Box>
    );
  }

  if (chartData.length === 0) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100%">
        <Typography color="textSecondary" variant="body2">
          {t('No scaling data available')}
        </Typography>
      </Box>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={chartData}
        margin={{
          top: 10,
          right: 30,
          left: 20,
          bottom: 30,
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
        <XAxis
          dataKey="time"
          stroke="#888"
          fontSize={10}
          tick={AngledTick}
          tickLine={{ stroke: '#e0e0e0' }}
          interval={0} // Show all ticks (12 labels over 24 hours)
          height={50}
        />
        <YAxis
          stroke="#888"
          fontSize={10}
          tick={{ fontSize: 10 }}
          tickLine={{ stroke: '#e0e0e0' }}
          domain={[0, 'dataMax + 1']}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #ddd',
            borderRadius: '6px',
            fontSize: '11px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '5px' }} />
        <Line
          type="monotone"
          dataKey="Replicas"
          name={t('Replicas')}
          stroke="#66BB6A"
          strokeWidth={2}
          dot={{ fill: '#66BB6A', strokeWidth: 0, r: 2 }}
          activeDot={{ r: 4, stroke: '#66BB6A', strokeWidth: 2, fill: '#fff' }}
        />
        <Line
          type="monotone"
          dataKey="CPU"
          name={t('CPU')}
          stroke="#42A5F5"
          strokeWidth={2}
          dot={{ fill: '#42A5F5', strokeWidth: 0, r: 2 }}
          activeDot={{ r: 4, stroke: '#42A5F5', strokeWidth: 2, fill: '#fff' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
