// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import {
  bucketNamespaceCount,
  bucketNodeCount,
  kubernetesMinor,
  localeLanguage,
  sanitizeFeatureType,
  sanitizeKind,
  sanitizeRegion,
  sanitizeStatus,
  sanitizeTier,
} from './schema';

describe('sanitizeKind', () => {
  it('passes built-in k8s kinds through', () => {
    expect(sanitizeKind('Pod')).toBe('Pod');
    expect(sanitizeKind('Deployment')).toBe('Deployment');
  });
  it('clamps unknown kinds to "CustomResource"', () => {
    expect(sanitizeKind('MyCRD')).toBe('CustomResource');
  });
  it('passes the "Multiple" bucket sentinel through verbatim', () => {
    // extractKindFromPayload returns 'Multiple' for heterogeneous plural-resource events.
    expect(sanitizeKind('Multiple')).toBe('Multiple');
  });
  it('returns "Unknown" for missing input', () => {
    expect(sanitizeKind(undefined)).toBe('Unknown');
    expect(sanitizeKind('')).toBe('Unknown');
  });
});

describe('sanitizeRegion (regex shape match)', () => {
  it('passes known-shape regions through, lowercased', () => {
    expect(sanitizeRegion('eastus')).toBe('eastus');
    expect(sanitizeRegion('eastus2')).toBe('eastus2');
    expect(sanitizeRegion('westeurope')).toBe('westeurope');
    expect(sanitizeRegion('australiasoutheast')).toBe('australiasoutheast');
    expect(sanitizeRegion('Eastus')).toBe('eastus'); // case-insensitive
  });
  it('clamps anything that does not match the shape to "Other"', () => {
    expect(sanitizeRegion('garbage')).toBe('Other');
    expect(sanitizeRegion('us-east-1')).toBe('Other'); // AWS shape
    expect(sanitizeRegion('eastus-prod')).toBe('Other');
  });
  it('returns "Other" for missing input', () => {
    expect(sanitizeRegion(undefined)).toBe('Other');
    expect(sanitizeRegion('')).toBe('Other');
  });
});

describe('sanitizeTier', () => {
  it.each(['Free', 'Standard', 'Premium'])('passes "%s" through', tier => {
    expect(sanitizeTier(tier)).toBe(tier);
  });
  it('clamps unknown tiers to "Unknown"', () => {
    expect(sanitizeTier('Enterprise')).toBe('Unknown');
    expect(sanitizeTier('')).toBe('Unknown');
    expect(sanitizeTier(undefined)).toBe('Unknown');
  });
});

describe('sanitizeFeatureType', () => {
  it('returns the input verbatim for allowlisted feature names', () => {
    expect(sanitizeFeatureType('headlamp.delete-resource')).toBe('headlamp.delete-resource');
    expect(sanitizeFeatureType('headlamp.list-view')).toBe('headlamp.list-view');
  });
  it('returns undefined for unknown feature names', () => {
    expect(sanitizeFeatureType('headlamp.unknown')).toBeUndefined();
    expect(sanitizeFeatureType('cluster:my-prod')).toBeUndefined();
    expect(sanitizeFeatureType(undefined)).toBeUndefined();
  });
});

describe('sanitizeStatus', () => {
  it('passes known statuses through', () => {
    expect(sanitizeStatus('unknown')).toBe('unknown');
    expect(sanitizeStatus('open')).toBe('open');
    expect(sanitizeStatus('closed')).toBe('closed');
    expect(sanitizeStatus('confirmed')).toBe('confirmed');
    expect(sanitizeStatus('finished')).toBe('finished');
  });
  it('clamps any other string to "unknown"', () => {
    expect(sanitizeStatus('cluster:my-prod')).toBe('unknown');
    expect(sanitizeStatus('error: foo')).toBe('unknown');
    expect(sanitizeStatus('')).toBe('unknown');
    expect(sanitizeStatus(undefined)).toBe('unknown');
  });
});

describe('bucketNodeCount', () => {
  it.each([
    [-1, '0'],
    [0, '0'],
    [1, '1-5'],
    [5, '1-5'],
    [6, '6-20'],
    [20, '6-20'],
    [21, '21-100'],
    [100, '21-100'],
    [101, '100+'],
    [10000, '100+'],
  ])('buckets %i as "%s"', (n, expected) => {
    expect(bucketNodeCount(n)).toBe(expected);
  });
});

describe('bucketNamespaceCount', () => {
  it.each([
    [-1, '0'],
    [0, '0'],
    [1, '1-10'],
    [10, '1-10'],
    [11, '11-50'],
    [50, '11-50'],
    [51, '51-200'],
    [200, '51-200'],
    [201, '200+'],
  ])('buckets %i as "%s"', (n, expected) => {
    expect(bucketNamespaceCount(n)).toBe(expected);
  });
});

describe('kubernetesMinor', () => {
  it.each([
    ['v1.29.4', '1.29'],
    ['1.29.4', '1.29'],
    ['v1.28', '1.28'],
    ['1.30.0-beta.1', '1.30'],
  ])('truncates "%s" to "%s"', (v, expected) => {
    expect(kubernetesMinor(v)).toBe(expected);
  });
  it('returns "unknown" for malformed input', () => {
    expect(kubernetesMinor('not-a-version')).toBe('unknown');
    expect(kubernetesMinor('')).toBe('unknown');
  });
});

describe('localeLanguage', () => {
  it.each([
    ['en-US', 'en'],
    ['en_US', 'en'],
    ['ja', 'ja'],
    ['zh-Hans-CN', 'zh'],
  ])('extracts language from "%s" as "%s"', (locale, expected) => {
    expect(localeLanguage(locale)).toBe(expected);
  });
  it('returns "unknown" for empty input', () => {
    expect(localeLanguage('')).toBe('unknown');
  });
});
