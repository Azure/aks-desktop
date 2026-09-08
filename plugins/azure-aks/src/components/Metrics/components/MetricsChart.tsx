// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Card, Typography } from '@mui/material';
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
import {
  ChartDataPoint,
  NetworkDataPoint,
  RequestErrorDataPoint,
  ResponseTimeDataPoint,
} from '../utils';

type MetricsDataPoint =
  | ChartDataPoint
  | ResponseTimeDataPoint
  | RequestErrorDataPoint
  | NetworkDataPoint;

/**
 * Configuration for a line in a {@link MetricsChart}.
 * Each line represents a metric to display, with the data key, color, and name for the legend.
 */
export interface LineConfig {
  /** The key of the data to display for this line. */
  dataKey: string;
  /** The color of the line. */
  stroke: string;
  /** The name of the line, displayed in the legend. */
  name: string;
}

/** Props for {@link MetricsChart}. */
export interface MetricsChartProps {
  title: string;
  /** The data points to display in the chart. */
  data: MetricsDataPoint[];
  /**
   * The configuration for each line in the chart.
   * @see LineConfig
   */
  lines: LineConfig[];
  /** The label for the Y-axis. */
  yAxisLabel: string;
  /** Message to display when there is no data available. */
  emptyMessage?: string;
}

/** General chart component with configurable title, lines, and optional empty-state message. */
export const MetricsChart: React.FC<MetricsChartProps> = ({
  title,
  data,
  lines,
  yAxisLabel,
  emptyMessage,
}) => {
  const { t } = useTranslation();
  const resolvedEmptyMessage = emptyMessage ?? t('No data available');
  return (
    <Card sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" />
            <YAxis
              label={{
                value: yAxisLabel,
                angle: -90,
                position: 'insideLeft',
                offset: 10,
              }}
            />
            <Tooltip />
            <Legend />
            {lines.map(line => (
              <Line
                key={line.dataKey}
                type="monotone"
                dataKey={line.dataKey}
                stroke={line.stroke}
                name={line.name}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <Typography color="text.secondary">{resolvedEmptyMessage}</Typography>
      )}
    </Card>
  );
};
