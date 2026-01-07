// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Box, Typography } from '@mui/material';
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

interface ScalingChartProps {
  chartData: ChartDataPoint[];
}

/**
 * Displays the scaling metrics chart (replicas and CPU over time)
 */
export const ScalingChart: React.FC<ScalingChartProps> = ({ chartData }) => {
  if (chartData.length === 0) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100%">
        <Typography color="textSecondary" variant="body2">
          No scaling data available
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
          tick={{ fontSize: 10 }}
          tickLine={{ stroke: '#e0e0e0' }}
          interval={5} // Show every 6th tick to avoid crowding
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
          stroke="#66BB6A"
          strokeWidth={2}
          dot={{ fill: '#66BB6A', strokeWidth: 0, r: 2 }}
          activeDot={{ r: 4, stroke: '#66BB6A', strokeWidth: 2, fill: '#fff' }}
        />
        <Line
          type="monotone"
          dataKey="CPU"
          stroke="#42A5F5"
          strokeWidth={2}
          dot={{ fill: '#42A5F5', strokeWidth: 0, r: 2 }}
          activeDot={{ r: 4, stroke: '#42A5F5', strokeWidth: 2, fill: '#fff' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
