// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 *  Tests for utility functions in src/components/Metrics/utils.ts
 */

import { describe, expect, test } from 'vitest';
import {
  convertBytesToUnit,
  defaultMetricSummary,
  formatMemoryBrief,
  pickMemoryUnit,
  safeParseFloat,
} from './utils';

const ONE_MB = 1024 * 1024;
const ONE_GB = 1024 * 1024 * 1024;

describe('pickMemoryUnit', () => {
  test('returns MB when all values are below 1 GB', () => {
    expect(pickMemoryUnit([100, ONE_MB, ONE_GB - 1])).toBe('MB');
  });

  test('returns GB when any value is at or above 1 GB', () => {
    expect(pickMemoryUnit([100, ONE_GB])).toBe('GB');
    expect(pickMemoryUnit([100, 2 * ONE_GB])).toBe('GB');
    expect(pickMemoryUnit([-1, ONE_GB])).toBe('GB');
  });

  test('returns MB for an empty samples array', () => {
    expect(pickMemoryUnit([])).toBe('MB');
  });

  test('filters out NaN and negative values', () => {
    expect(pickMemoryUnit([NaN, -100, -1, ONE_GB])).toBe('GB');
  });

  test('filters out Infinity', () => {
    expect(pickMemoryUnit([Infinity, 100])).toBe('MB');
  });
});

describe('convertBytesToUnit', () => {
  test('converts bytes to MB correctly', () => {
    expect(convertBytesToUnit(ONE_MB, 'MB')).toBe(1);
    expect(convertBytesToUnit(ONE_MB * 256, 'MB')).toBe(256);
    expect(convertBytesToUnit(ONE_MB * 1.34, 'MB')).toBe(1.34);
  });

  test('converts bytes to GB correctly', () => {
    expect(convertBytesToUnit(ONE_GB, 'GB')).toBe(1);
    expect(convertBytesToUnit(ONE_GB * 20, 'GB')).toBe(20);
    expect(convertBytesToUnit(ONE_GB * 2.5, 'GB')).toBe(2.5);
  });

  test('returns 0 for NaN input', () => {
    expect(convertBytesToUnit(NaN, 'MB')).toBe(0);
  });

  test('returns 0 for Infinity input', () => {
    expect(convertBytesToUnit(Infinity, 'GB')).toBe(0);
  });

  test('returns 0 for negative Infinity input', () => {
    expect(convertBytesToUnit(-Infinity, 'MB')).toBe(0);
  });

  test('handles zero bytes', () => {
    expect(convertBytesToUnit(0, 'MB')).toBe(0);
    expect(convertBytesToUnit(0, 'GB')).toBe(0);
  });
});

describe('formatMemoryBrief', () => {
  test('formats values below 1 GB as MB', () => {
    expect(formatMemoryBrief(400 * ONE_MB)).toBe('400.00 MB');
  });

  test('formats values at or above 1 GB as GB', () => {
    expect(formatMemoryBrief(2.5 * ONE_GB)).toBe('2.50 GB');
  });

  test('formats exactly 1 GB', () => {
    expect(formatMemoryBrief(1.0 * ONE_GB)).toBe('1.00 GB');
  });

  test('returns N/A for negative values', () => {
    expect(formatMemoryBrief(-1)).toBe('N/A');
  });

  test('returns N/A for NaN', () => {
    expect(formatMemoryBrief(NaN)).toBe('N/A');
  });

  test('returns N/A for Infinity', () => {
    expect(formatMemoryBrief(Infinity)).toBe('N/A');
  });

  test('handles zero bytes', () => {
    expect(formatMemoryBrief(0)).toBe('0.00 MB');
  });
});

describe('safeParseFloat', () => {
  test('parses valid number strings', () => {
    expect(safeParseFloat('3.14')).toBe(3.14);
    expect(safeParseFloat('0')).toBe(0);
    expect(safeParseFloat('100')).toBe(100);
  });

  test('returns 0 for NaN strings', () => {
    expect(safeParseFloat('NaN')).toBe(0);
    expect(safeParseFloat('not-a-number')).toBe(0);
  });

  test('returns 0 for Infinity strings', () => {
    expect(safeParseFloat('Infinity')).toBe(0);
    expect(safeParseFloat('-Infinity')).toBe(0);
  });
});

describe('defaultMetricSummary', () => {
  test('has expected default values', () => {
    expect(defaultMetricSummary).toEqual({
      totalPods: 0,
      requestRate: 'N/A',
      errorRate: 'N/A',
      cpuUsage: 'N/A',
      memoryUsage: 'N/A',
      projectStatus: 'Unknown',
    });
  });
});
