// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Unit for displaying memory values in charts and summaries. */
export type MemoryUnit = 'MB' | 'GB';

/** Single data point for CPU & memory time-series charts. */
export interface ChartDataPoint {
  timestamp: string;
  value: number;
}

/** Single data point for the response time chart. */
export interface ResponseTimeDataPoint {
  timestamp: string;
  responseTime: number;
}

/** Single data point for the request & error rate chart. */
export interface RequestErrorDataPoint {
  timestamp: string;
  requestRate: number;
  errorRate: number;
}

/** Single data point for the network I/O chart. */
export interface NetworkDataPoint {
  timestamp: string;
  networkIn: number;
  networkOut: number;
}

/** Key metrics that are displayed in the summary bar. */
export interface MetricSummary {
  totalPods: number;
  requestRate: string;
  errorRate: string;
  cpuUsage: string;
  memoryUsage: string;
  projectStatus: string;
}

/**
 * Picks an appropriate memory unit based on sampled byte values.
 *
 * @param samples - Raw byte values from Prometheus.
 * @returns 'GB' if the max sample exceeds 1 GB, otherwise 'MB'.
 */
export function pickMemoryUnit(samples: number[]): MemoryUnit {
  const validSamples = samples.filter(value => Number.isFinite(value) && value >= 0);
  if (validSamples.length === 0) {
    return 'MB';
  }
  const maxBytes = Math.max(...validSamples);
  return maxBytes >= 1024 * 1024 * 1024 ? 'GB' : 'MB';
}

/**
 * Converts a byte value to the given memory unit.
 *
 * @param bytes - Raw byte count.
 * @param unit - Target unit of measurement ('MB' or 'GB').
 * @returns Converted value, or 0 if the input is not finite.
 */
export function convertBytesToUnit(bytes: number, unit: MemoryUnit): number {
  // Safeguard for return values
  if (!Number.isFinite(bytes)) {
    return 0;
  }
  const divisor = unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024;
  return bytes / divisor;
}

/**
 * Formats byte values into brief human-readable strings.
 *
 * @param bytes - Raw byte count.
 * @returns A string like '1.23 GB' or '400.55 MB', or 'N/A' for invalid input.
 */
export function formatMemoryBrief(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'N/A';
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Parses a Prometheus sample value, returning 0 for NaN/Infinity.
 *
 * @param value - Raw string value from a Prometheus result.
 * @returns The parsed number, or 0 if the value is NaN or Infinity.
 */
export function safeParseFloat(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Default metric summary values shown before data is loaded. */
export const defaultMetricSummary: MetricSummary = {
  totalPods: 0,
  requestRate: 'N/A',
  errorRate: 'N/A',
  cpuUsage: 'N/A',
  memoryUsage: 'N/A',
  projectStatus: 'Unknown',
};
