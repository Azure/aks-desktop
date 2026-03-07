// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Safely narrows an unknown value to a plain object record.
 * Returns undefined for null, arrays, and non-object types.
 */
export function safeRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
