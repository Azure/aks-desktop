// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { formatCpu, formatMemory, parseCpuToMillicores, parseMemoryToBytes } from './resourceUnits';

describe('parseCpuToMillicores', () => {
  it('parses millicore format', () => {
    expect(parseCpuToMillicores('100m')).toBe(100);
    expect(parseCpuToMillicores('500m')).toBe(500);
    expect(parseCpuToMillicores('1000m')).toBe(1000);
  });

  it('parses whole core format', () => {
    expect(parseCpuToMillicores('1')).toBe(1000);
    expect(parseCpuToMillicores('2')).toBe(2000);
  });

  it('parses fractional core format', () => {
    expect(parseCpuToMillicores('0.5')).toBe(500);
    expect(parseCpuToMillicores('0.1')).toBe(100);
    expect(parseCpuToMillicores('1.5')).toBe(1500);
  });

  it('parses nanocores', () => {
    expect(parseCpuToMillicores('1000000n')).toBe(1);
    expect(parseCpuToMillicores('100n')).toBe(0.0001);
  });

  it('parses microcores', () => {
    expect(parseCpuToMillicores('1000u')).toBe(1);
    expect(parseCpuToMillicores('250u')).toBe(0.25);
    expect(parseCpuToMillicores('1000µ')).toBe(1);
  });

  it('parses decimal SI CPU suffixes without rounding', () => {
    expect(parseCpuToMillicores('1k')).toBe(1_000_000);
    expect(parseCpuToMillicores('1.5k')).toBe(1_500_000);
  });

  it('returns 0 for invalid input', () => {
    expect(parseCpuToMillicores('')).toBe(0);
    expect(parseCpuToMillicores('abc')).toBe(0);
    expect(parseCpuToMillicores('m')).toBe(0);
    expect(parseCpuToMillicores('1junk')).toBe(0);
    expect(parseCpuToMillicores('1e')).toBe(0);
  });
});

describe('parseMemoryToBytes', () => {
  it('parses Mi suffix', () => {
    expect(parseMemoryToBytes('128Mi')).toBe(128 * 1024 ** 2);
    expect(parseMemoryToBytes('512Mi')).toBe(512 * 1024 ** 2);
  });

  it('parses Gi suffix', () => {
    expect(parseMemoryToBytes('1Gi')).toBe(1024 ** 3);
    expect(parseMemoryToBytes('2Gi')).toBe(2 * 1024 ** 3);
  });

  it('preserves fractional binary quantities', () => {
    expect(parseMemoryToBytes('256.5Mi')).toBe(256.5 * 1024 ** 2);
    expect(parseMemoryToBytes('262656Ki')).toBe(256.5 * 1024 ** 2);
    expect(parseMemoryToBytes('1000000000000000u')).toBe(1e9);
    expect(parseMemoryToBytes('1000000000000000000n')).toBe(1e9);
  });

  it('parses signed decimals, leading decimals, and exponents', () => {
    expect(parseMemoryToBytes('+512Mi')).toBe(512 * 1024 ** 2);
    expect(parseMemoryToBytes('.5Gi')).toBe(0.5 * 1024 ** 3);
    expect(parseMemoryToBytes('1e9')).toBe(1e9);
  });

  it('parses signed decimals, leading decimals, and exponents', () => {
    expect(parseMemoryToBytes('+512Mi')).toBe(512 * 1024 ** 2);
    expect(parseMemoryToBytes('.5Gi')).toBe(0.5 * 1024 ** 3);
    expect(parseMemoryToBytes('1e9')).toBe(1e9);
  });

  it('parses Ki suffix', () => {
    expect(parseMemoryToBytes('512Ki')).toBe(512 * 1024);
  });

  it('parses plain bytes', () => {
    expect(parseMemoryToBytes('1000')).toBe(1000);
  });

  it('parses decimal suffixes', () => {
    expect(parseMemoryToBytes('1M')).toBe(1000 ** 2);
    expect(parseMemoryToBytes('1G')).toBe(1000 ** 3);
    expect(parseMemoryToBytes('1k')).toBe(1000);
  });

  it('parses large binary suffixes', () => {
    expect(parseMemoryToBytes('1Pi')).toBe(1024 ** 5);
    expect(parseMemoryToBytes('1Ei')).toBe(1024 ** 6);
  });

  it('parses large decimal suffixes', () => {
    expect(parseMemoryToBytes('1P')).toBe(1000 ** 5);
    expect(parseMemoryToBytes('1E')).toBe(1000 ** 6);
  });

  it('returns 0 for invalid input', () => {
    expect(parseMemoryToBytes('')).toBe(0);
    expect(parseMemoryToBytes('abc')).toBe(0);
    expect(parseMemoryToBytes('1e308Mi')).toBe(0);
  });
});

describe('formatMemory', () => {
  it('formats as Pi for very large values', () => {
    expect(formatMemory(1024 ** 5)).toBe('1Pi');
    expect(formatMemory(2 * 1024 ** 5)).toBe('2Pi');
  });

  it('formats as Ti for large values', () => {
    expect(formatMemory(1024 ** 4)).toBe('1Ti');
    expect(formatMemory(1.5 * 1024 ** 4)).toBe('1.5Ti');
  });

  it('formats as Gi for large values', () => {
    expect(formatMemory(1024 ** 3)).toBe('1Gi');
    expect(formatMemory(1.5 * 1024 ** 3)).toBe('1.5Gi');
  });

  it('formats as Mi for medium values', () => {
    expect(formatMemory(128 * 1024 ** 2)).toBe('128Mi');
  });

  it('formats as Ki for small values', () => {
    expect(formatMemory(512 * 1024)).toBe('512Ki');
  });
});

describe('formatCpu', () => {
  it('formats whole cores', () => {
    expect(formatCpu(1000)).toBe('1');
    expect(formatCpu(2000)).toBe('2');
  });

  it('formats millicores', () => {
    expect(formatCpu(100)).toBe('100m');
    expect(formatCpu(500)).toBe('500m');
  });

  it('formats fractional cores with one decimal', () => {
    expect(formatCpu(1500)).toBe('1.5');
    expect(formatCpu(2500)).toBe('2.5');
    expect(formatCpu(1100)).toBe('1.1');
  });

  it('formats fractional cores with two decimals', () => {
    expect(formatCpu(1250)).toBe('1.25');
    expect(formatCpu(1010)).toBe('1.01');
  });

  it('falls back to millicores for non-round values', () => {
    expect(formatCpu(1234)).toBe('1234m');
    expect(formatCpu(1001)).toBe('1001m');
  });
});
