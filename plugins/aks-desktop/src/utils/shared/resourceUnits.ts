// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { unparseRam } from '@kinvolk/headlamp-plugin/lib/lib/units';

/**
 * Parses a Kubernetes CPU quantity string to millicores.
 * Preserves DecimalSI, BinarySI, fractional, and sub-millicore precision.
 *
 * @example parseCpuToMillicores("100m")  // 100
 * @example parseCpuToMillicores("1")     // 1000
 * @example parseCpuToMillicores("0.5")   // 500
 */
export function parseCpuToMillicores(val: string): number {
  const factors: Record<string, [decimalShift: number, binaryPower: number]> = {
    '': [3, 0],
    n: [-6, 0],
    u: [-3, 0],
    µ: [-3, 0],
    m: [0, 0],
    k: [6, 0],
    M: [9, 0],
    G: [12, 0],
    T: [15, 0],
    P: [18, 0],
    E: [21, 0],
    Ki: [3, 10],
    Mi: [3, 20],
    Gi: [3, 30],
    Ti: [3, 40],
    Pi: [3, 50],
    Ei: [3, 60],
  };
  return parseQuantity(String(val), factors);
}

/**
 * Parses a Kubernetes memory quantity string to bytes.
 * Supports DecimalSI, BinarySI, fractional, exponent, and decimal-unit quantities.
 *
 * @example parseMemoryToBytes("128Mi")  // 134217728
 * @example parseMemoryToBytes("1Gi")    // 1073741824
 * @example parseMemoryToBytes("512Ki")  // 524288
 * @example parseMemoryToBytes("1000")   // 1000
 */
export function parseMemoryToBytes(val: string): number {
  const factors: Record<string, [decimalShift: number, binaryPower: number]> = {
    '': [0, 0],
    m: [-3, 0],
    u: [-6, 0],
    n: [-9, 0],
    k: [3, 0],
    Ki: [0, 10],
    M: [6, 0],
    Mi: [0, 20],
    G: [9, 0],
    Gi: [0, 30],
    T: [12, 0],
    Ti: [0, 40],
    P: [15, 0],
    Pi: [0, 50],
    E: [18, 0],
    Ei: [0, 60],
  };
  return parseQuantity(String(val), factors);
}

function parseQuantity(
  input: string,
  factors: Record<string, [decimalShift: number, binaryPower: number]>
): number {
  const value = input.trim();
  if (!value || value.length > 1000) return 0;
  const match =
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))([eE][+-]?\d+)?(Ki|Mi|Gi|Ti|Pi|Ei|n|u|µ|m|k|M|G|T|P|E)?$/.exec(
      value
    );
  if (!match) return 0;
  const [, sign, whole = '0', fractionAfterWhole, fractionOnly, exponentText, unit = ''] = match;
  if (exponentText && unit) return 0;
  const fraction = fractionOnly ?? fractionAfterWhole ?? '';
  const exponent = Number(exponentText?.slice(1) ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) return 0;
  let digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '');
  const [decimalShift, binaryPower] = factors[unit] ?? [0, 0];
  if (!factors[unit]) return 0;
  for (let power = 0; power < binaryPower; power += 1) digits = doubleInteger(digits);
  const scale = exponent - fraction.length + decimalShift;
  let decimal: string;
  if (scale >= 0) {
    decimal = `${digits}${'0'.repeat(scale)}`;
  } else {
    const point = digits.length + scale;
    decimal =
      point > 0
        ? `${digits.slice(0, point)}.${digits.slice(point)}`
        : `0.${'0'.repeat(-point)}${digits}`;
  }
  const result = Number(`${sign === '-' ? '-' : ''}${decimal}`);
  return Number.isFinite(result) ? result : 0;
}

function doubleInteger(input: string): string {
  let carry = 0;
  let output = '';
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const value = Number(input[index]) * 2 + carry;
    output = `${value % 10}${output}`;
    carry = Math.floor(value / 10);
  }
  return `${carry || ''}${output}`.replace(/^0+(?=\d)/, '');
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
