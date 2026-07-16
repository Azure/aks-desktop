// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import {
  ERROR_AREAS,
  ERROR_CLASSES,
  EVENT_STATUSES,
  KNOWN_FEATURE_TYPES,
  KNOWN_ROUTES,
  sanitizeErrorClass,
  sanitizeRoute,
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_PROPERTY_KEYS,
} from './schema';

describe('telemetry privacy vocabularies', () => {
  it('enumerates every approved event name', () => {
    expect([...TELEMETRY_EVENT_NAMES]).toEqual([
      'headlamp.session-start',
      'headlamp.cluster-shape',
      'headlamp.feature',
      'headlamp.exception',
      'headlamp.plugins-loaded',
    ]);
  });

  it('enumerates every approved custom property key', () => {
    expect([...TELEMETRY_PROPERTY_KEYS]).toEqual([
      'appVersion',
      'locale',
      'os',
      'arch',
      'electronVersion',
      'headlampVersion',
      'provider',
      'kubernetesMinor',
      'nodeCountBucket',
      'namespaceCountBucket',
      'region',
      'aksTier',
      'feature',
      'status',
      'resourceKind',
      'errorClass',
      'area',
      'phase',
      'totalCount',
      'enabledCount',
      'knownEnabledIds',
      'thirdPartyCount',
    ]);
  });

  it('enumerates every approved feature type', () => {
    expect([...KNOWN_FEATURE_TYPES]).toEqual([
      'headlamp.delete-resource',
      'headlamp.delete-resources',
      'headlamp.create-resource',
      'headlamp.edit-resource',
      'headlamp.scale-resource',
      'headlamp.restart-resource',
      'headlamp.restart-resources',
      'headlamp.rollback-resource',
      'headlamp.logs',
      'headlamp.terminal',
      'headlamp.pod-attach',
      'headlamp.plugin-loading-error',
      'headlamp.details-view',
      'headlamp.list-view',
      'headlamp.object-events',
      'aksd.project-create',
      'aksd.project-import',
      'aksd.deploy',
    ]);
  });

  it('enumerates every approved status', () => {
    expect([...EVENT_STATUSES]).toEqual([
      'unknown',
      'open',
      'closed',
      'confirmed',
      'finished',
      'opened',
      'started',
      'succeeded',
      'failed',
      'cancelled',
      'completed',
    ]);
  });

  it('enumerates every approved route', () => {
    expect([...KNOWN_ROUTES]).toEqual([
      '/index',
      '/login',
      '/profile',
      '/projects',
      '/project-create',
      '/project-import',
      '/namespace-create',
      '/add-cluster',
      '/settings',
      'unknown',
    ]);
  });

  it('enumerates every approved error class and area', () => {
    expect([...ERROR_CLASSES]).toEqual([
      'AuthenticationError',
      'PermissionError',
      'NetworkError',
      'ValidationError',
      'TimeoutError',
      'UnknownError',
    ]);
    expect([...ERROR_AREAS]).toEqual([
      'project-create',
      'project-import',
      'deploy',
      'kubernetes',
      'plugin-ui',
    ]);
  });
});

describe('sanitizeRoute', () => {
  it.each([
    ['/', '/index'],
    ['/index', '/index'],
    ['/azure/login', '/login'],
    ['/azure/profile', '/profile'],
    ['/projects', '/projects'],
    ['/projects/create-aks-project', '/project-create'],
    ['/projects/import-aks-projects', '/project-import'],
    ['/projects/create-namespace', '/namespace-create'],
    ['/add-cluster-aks', '/add-cluster'],
    ['/settings/plugins/aks-desktop', '/settings'],
  ])('maps %s to %s', (input, expected) => {
    expect(sanitizeRoute(input)).toBe(expected);
  });

  it('never echoes unknown paths, identifiers, queries, or URLs', () => {
    expect(sanitizeRoute('/projects/customer-cluster')).toBe('unknown');
    expect(sanitizeRoute('/index?subscription=synthetic-secret')).toBe('/index');
    expect(sanitizeRoute('https://example.invalid/customer')).toBe('unknown');
    expect(sanitizeRoute(undefined)).toBe('unknown');
  });
});

describe('sanitizeErrorClass', () => {
  it('passes approved classes through', () => {
    expect(sanitizeErrorClass('NetworkError')).toBe('NetworkError');
  });

  it('clamps arbitrary error names to UnknownError', () => {
    expect(sanitizeErrorClass('CustomerClusterError')).toBe('UnknownError');
    expect(sanitizeErrorClass(undefined)).toBe('UnknownError');
  });
});
