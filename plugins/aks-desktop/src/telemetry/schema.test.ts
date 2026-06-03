// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import {
  bucketNamespaceCount,
  bucketNodeCount,
  BUILTIN_K8S_KINDS,
  KNOWN_ERROR_NAMES,
  KNOWN_EVENT_NAMES,
  KNOWN_PROPERTY_KEYS,
  kubernetesMinor,
  localeLanguage,
  osMajor,
  sanitizeErrorName,
  sanitizeKind,
  sanitizeRegion,
} from './schema';

describe('sanitizeKind', () => {
  it('returns built-in kinds verbatim', () => {
    expect(sanitizeKind('Pod')).toBe('Pod');
    expect(sanitizeKind('Deployment')).toBe('Deployment');
  });
  it('collapses unknown kinds to CustomResource', () => {
    expect(sanitizeKind('ArgoApplication')).toBe('CustomResource');
    expect(sanitizeKind('MyCRD')).toBe('CustomResource');
  });
  it('returns Unknown for undefined/empty', () => {
    expect(sanitizeKind(undefined)).toBe('Unknown');
    expect(sanitizeKind('')).toBe('Unknown');
  });
});

describe('sanitizeErrorName', () => {
  it('returns allowlisted names verbatim', () => {
    expect(sanitizeErrorName('TypeError')).toBe('TypeError');
    expect(sanitizeErrorName('KubeApiError')).toBe('KubeApiError');
  });
  it('collapses unknown to Other', () => {
    expect(sanitizeErrorName('WeirdCustomError')).toBe('Other');
  });
  it('returns Other for undefined/empty', () => {
    expect(sanitizeErrorName(undefined)).toBe('Other');
    expect(sanitizeErrorName('')).toBe('Other');
  });
});

describe('sanitizeRegion', () => {
  it('returns allowlisted regions verbatim', () => {
    expect(sanitizeRegion('eastus')).toBe('eastus');
    expect(sanitizeRegion('westeurope')).toBe('westeurope');
  });
  it('collapses unknown to Other', () => {
    expect(sanitizeRegion('madeupregion')).toBe('Other');
    expect(sanitizeRegion(undefined)).toBe('Other');
  });
});

describe('bucketNodeCount', () => {
  it.each([
    [0, '1-5'],
    [1, '1-5'],
    [5, '1-5'],
    [6, '6-20'],
    [20, '6-20'],
    [21, '21-100'],
    [100, '21-100'],
    [101, '100+'],
    [5000, '100+'],
  ])('%d → %s', (n, expected) => {
    expect(bucketNodeCount(n)).toBe(expected);
  });
});

describe('bucketNamespaceCount', () => {
  it.each([
    [0, '1-10'],
    [10, '1-10'],
    [11, '11-50'],
    [50, '11-50'],
    [51, '51-200'],
    [200, '51-200'],
    [201, '200+'],
  ])('%d → %s', (n, expected) => {
    expect(bucketNamespaceCount(n)).toBe(expected);
  });
});

describe('kubernetesMinor', () => {
  it.each([
    ['v1.29.4', '1.29'],
    ['1.30.0', '1.30'],
    ['v1.28', '1.28'],
  ])('%s → %s', (v, expected) => {
    expect(kubernetesMinor(v)).toBe(expected);
  });
  it('returns "unknown" for malformed input', () => {
    expect(kubernetesMinor('')).toBe('unknown');
    expect(kubernetesMinor('garbage')).toBe('unknown');
  });
});

describe('localeLanguage', () => {
  it.each([
    ['en-US', 'en'],
    ['en', 'en'],
    ['pt-BR', 'pt'],
    ['ja-JP', 'ja'],
  ])('%s → %s', (l, expected) => {
    expect(localeLanguage(l)).toBe(expected);
  });
  it('returns "unknown" for empty', () => {
    expect(localeLanguage('')).toBe('unknown');
  });
});

describe('osMajor', () => {
  it.each([
    ['14.0.1', '14'],
    ['10.0.22631', '10'],
    ['6.5.0-15-generic', '6'],
  ])('%s → %s', (r, expected) => {
    expect(osMajor(r)).toBe(expected);
  });
  it('returns "unknown" for non-numeric leading component', () => {
    expect(osMajor('abc')).toBe('unknown');
    expect(osMajor('')).toBe('unknown');
  });
});

describe('vocabulary sets', () => {
  it('BUILTIN_K8S_KINDS contains expected staples', () => {
    expect(BUILTIN_K8S_KINDS.has('Pod')).toBe(true);
    expect(BUILTIN_K8S_KINDS.has('Deployment')).toBe(true);
    expect(BUILTIN_K8S_KINDS.has('Service')).toBe(true);
    expect(BUILTIN_K8S_KINDS.has('Namespace')).toBe(true);
    expect(BUILTIN_K8S_KINDS.has('Node')).toBe(true);
  });
  it('KNOWN_ERROR_NAMES contains expected staples', () => {
    expect(KNOWN_ERROR_NAMES.has('TypeError')).toBe(true);
    expect(KNOWN_ERROR_NAMES.has('KubeApiError')).toBe(true);
  });
  it('KNOWN_EVENT_NAMES contains the five headlamp.* names plus the "exception" shim', () => {
    expect(new Set(KNOWN_EVENT_NAMES)).toEqual(
      new Set([
        'headlamp.session-start',
        'headlamp.cluster-shape',
        'headlamp.feature',
        'headlamp.exception',
        'headlamp.plugins-loaded',
        'exception',
      ])
    );
  });
  it('KNOWN_PROPERTY_KEYS is the exact union of event property keys', () => {
    // This is the drift guardrail. If you add a property to any helper,
    // update KNOWN_PROPERTY_KEYS at the same time or this test breaks.
    const expected = new Set([
      'installId',
      'appVersion',
      'headlampVersion',
      'electronVersion',
      'os',
      'osMajor',
      'arch',
      'locale',
      'provider',
      'kubernetesMinor',
      'nodeCountBucket',
      'namespaceCountBucket',
      'region',
      'aksTier',
      'feature',
      'status',
      'resourceKind',
      'errorName',
      'totalCount',
      'enabledCount',
      'knownEnabledIds',
      'thirdPartyCount',
    ]);
    expect(new Set(KNOWN_PROPERTY_KEYS)).toEqual(expected);
  });
});
