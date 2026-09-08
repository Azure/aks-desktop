// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  parseCpu,
  parseRam,
  TO_ONE_M_CPU,
  unparseRam,
} from '@kinvolk/headlamp-plugin/lib/lib/units';

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

  // µ suffix not handled by Headlamp's parseCpu
  if (s.endsWith('µ')) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? Math.round(n * 1e-3) : 0;
  }

  // For suffix-based values (m, n, u), delegate to Headlamp
  if (s.endsWith('m') || s.endsWith('n') || s.endsWith('u')) {
    const result = Math.round(parseCpu(s) / TO_ONE_M_CPU);
    return Number.isFinite(result) ? result : 0;
  }

  // Plain numeric values — use parseFloat to support fractional cores (e.g. "0.5")
  // since Headlamp's parseCpu uses parseInt which truncates these
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
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

  // Headlamp's parseRam doesn't support lowercase 'k'
  if (s.endsWith('k')) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? Math.round(n * 1000) : 0;
  }

  const result = parseRam(s);
  return Number.isFinite(result) ? result : 0;
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
