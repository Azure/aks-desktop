// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { KNOWN_ROUTES, sanitizeRoute } from './schema';

const DENIED_VALUE_PATTERNS: readonly RegExp[] = [
  /\/subscriptions\/[^/\s]+/i,
  /\/resourceGroups\/[^/\s]+/i,
  /\/managedClusters\/[^/\s]+/i,
  /(?:^|[=\s"'(])\/(?!\/)[^\s"'?#]+/i,
  /(?:^|[=\s"'(])[a-z]:[\\/][^\s"'?#]+/i,
  /file:\/\//i,
  /https?:\/\//i,
];

const DENIED_GEO_KEYS = new Set([
  'ai.location.country',
  'ai.location.province',
  'ai.location.city',
  'client_countryorregion',
  'client_stateorprovince',
  'client_city',
]);

function isDeniedKey(key: string): boolean {
  return DENIED_GEO_KEYS.has(key.toLowerCase()) || isDeniedValue(key);
}

function isDeniedValue(value: string): boolean {
  if (KNOWN_ROUTES.has(value)) return false;
  return DENIED_VALUE_PATTERNS.some(pattern => pattern.test(value));
}

function containsDeniedData(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value === 'string') return isDeniedValue(value);
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some(item => containsDeniedData(item, seen));
  }

  return Object.entries(value).some(([key, nestedValue]) => {
    if (isDeniedKey(key)) return true;
    if (key === 'ai.operation.name') {
      return typeof nestedValue !== 'string' || sanitizeRoute(nestedValue) !== nestedValue;
    }
    if (key === 'ai.location.ip') return nestedValue !== '0.0.0.0';
    return containsDeniedData(nestedValue, seen);
  });
}

export function assertNoPII(value: unknown): void {
  if (containsDeniedData(value, new WeakSet())) {
    throw new Error('Telemetry payload contains denied data');
  }
}

function scrubValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'string') return isDeniedValue(value) ? undefined : value;
  if (value === null || typeof value !== 'object') return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const scrubbed: unknown[] = [];
    seen.set(value, scrubbed);
    for (const item of value) {
      const safeItem = scrubValue(item, seen);
      if (safeItem !== undefined) scrubbed.push(safeItem);
    }
    return scrubbed;
  }

  const scrubbed: Record<string, unknown> = {};
  seen.set(value, scrubbed);
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isDeniedKey(key)) continue;
    if (key === 'ai.operation.name') {
      scrubbed[key] = sanitizeRoute(typeof nestedValue === 'string' ? nestedValue : undefined);
      continue;
    }
    if (key === 'ai.location.ip') {
      scrubbed[key] = '0.0.0.0';
      continue;
    }
    const safeValue = scrubValue(nestedValue, seen);
    if (safeValue !== undefined) scrubbed[key] = safeValue;
  }
  return scrubbed;
}

export function scrubTelemetryData<T>(value: T): T {
  return scrubValue(value, new WeakMap()) as T;
}
