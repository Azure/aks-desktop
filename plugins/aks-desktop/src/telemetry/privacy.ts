// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const DENIED_VALUE_PATTERNS: readonly RegExp[] = [
  /\/subscriptions\/[^/\s]+/i,
  /\/resourceGroups\/[^/\s]+/i,
  /\/managedClusters\/[^/\s]+/i,
  /(?:^|[\s"'])\/(?:home|Users)\/[^/\s]+\//i,
  /(?:^|[\s"'])[a-z]:[\\/]Users[\\/][^\\/\s]+[\\/]/i,
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
  return DENIED_GEO_KEYS.has(key.toLowerCase());
}

function isDeniedValue(value: string): boolean {
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

  return Object.entries(value).some(
    ([key, nestedValue]) => isDeniedKey(key) || containsDeniedData(nestedValue, seen)
  );
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
    const safeValue = scrubValue(nestedValue, seen);
    if (safeValue !== undefined) scrubbed[key] = safeValue;
  }
  return scrubbed;
}

export function scrubTelemetryData<T>(value: T): T {
  return scrubValue(value, new WeakMap()) as T;
}
