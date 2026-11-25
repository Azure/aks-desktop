// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { unparseRam } from '@kinvolk/headlamp-plugin/lib/lib/units';

/**
 * Parses a Kubernetes CPU quantity string to millicores.
 * Delegates to Headlamp's parseCpu (nanocores) for suffix-based values,
 * with local handling for fractional cores and µ suffix.
 *
 * @example parseCpuToMillicores("100m")  // 100
 * @example parseCpuToMillicores("1")     // 1000
 * @example parseCpuToMillicores("0.5")   // 500
 */
export function parseCpuToMillicores(val: string): number {
  const s = String(val).trim();
  if (!s) return 0;

  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([numkMGTPEµ]?)$/.exec(s);
  if (!match) return 0;
  if (match[2] && /e/i.test(match[1])) return 0;
  const value = Number(match[1]);
  const factors: Record<string, number> = {
    '': 1000,
    m: 1,
    k: 1_000_000,
    M: 1_000_000_000,
    G: 1_000_000_000_000,
    T: 1_000_000_000_000_000,
    P: 1_000_000_000_000_000_000,
    E: 1_000_000_000_000_000_000_000,
  };
  const result =
    match[2] === 'n'
      ? value / 1_000_000
      : match[2] === 'u' || match[2] === 'µ'
      ? value / 1000
      : value * factors[match[2]];
  return Number.isFinite(result) ? result : 0;
}

/**
 * Parses a Kubernetes memory quantity string to bytes.
 * Delegates to Headlamp's parseRam with fallback for lowercase 'k' suffix.
 *
 * @example parseMemoryToBytes("128Mi")  // 134217728
 * @example parseMemoryToBytes("1Gi")    // 1073741824
 * @example parseMemoryToBytes("512Ki")  // 524288
 * @example parseMemoryToBytes("1000")   // 1000
 */
export function parseMemoryToBytes(val: string): number {
  const s = String(val).trim();
  if (!s) return 0;

  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([EPTGMK]i?|[kmnu])?$/.exec(s);
  if (match) {
    if (match[2] && /e/i.test(match[1])) return 0;
    const value = Number(match[1]);
    const unit = match[2] ?? '';
    const factors: Record<string, number> = {
      '': 1,
      m: 0.001,
      u: 0.000001,
      n: 0.000000001,
      k: 1000,
      K: 1000,
      Ki: 1024,
      M: 1000 ** 2,
      Mi: 1024 ** 2,
      G: 1000 ** 3,
      Gi: 1024 ** 3,
      T: 1000 ** 4,
      Ti: 1024 ** 4,
      P: 1000 ** 5,
      Pi: 1024 ** 5,
      E: 1000 ** 6,
      Ei: 1024 ** 6,
    };
    const factor = factors[unit];
    if (factor !== undefined && Number.isFinite(value)) {
      const result =
        unit === 'm'
          ? value / 1000
          : unit === 'u'
          ? value / 1_000_000
          : unit === 'n'
          ? value / 1_000_000_000
          : value * factor;
      return Number.isFinite(result) ? result : 0;
    }
  }
  return 0;
}

/**
 * Formats bytes as a human-readable memory string using binary suffixes.
 */
export function formatMemory(bytes: number): string {
  const { value, unit } = unparseRam(bytes);
  return `${value}${unit}`;
}

/**
 * Formats millicores as a human-readable CPU string.
 *
 * Values < 1000m use millicore notation (e.g. "500m").
 * Values >= 1000m use core notation with precision derived from millicores:
 *   divisible by 1000 → integer cores ("2"), by 100 → one decimal ("1.5"),
 *   by 10 → two decimals ("1.25"), otherwise falls back to millicores ("1234m").
 */
export function formatCpu(millicores: number): string {
  if (millicores < 1000) {
    return `${millicores}m`;
  }
  if (millicores % 1000 === 0) {
    return `${millicores / 1000}`;
  }
  if (millicores % 100 === 0) {
    return (millicores / 1000).toFixed(1);
  }
  if (millicores % 10 === 0) {
    return (millicores / 1000).toFixed(2);
  }
  return `${millicores}m`;
}
