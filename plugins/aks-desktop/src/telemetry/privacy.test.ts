// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { assertNoPII, scrubTelemetryData } from './privacy';

const deniedFixtures = [
  '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/synthetic-rg/providers/Microsoft.ContainerService/managedClusters/synthetic-cluster',
  '/resourceGroups/synthetic-rg',
  '/managedClusters/synthetic-cluster',
  '/home/synthetic-user/.azure/config',
  '/Users/synthetic-user/project/config.json',
  'C:\\Users\\synthetic-user\\project\\config.json',
  'file:///home/synthetic-user/config.json',
  'https://example.invalid/synthetic-cluster',
  'path=/home/synthetic-user/project/config.json',
  'path=/home/synthetic-user',
  '/root/.azure/config',
  '/var/home/synthetic-user/project/config.json',
  'path=C:\\Users\\synthetic-user\\project\\config.json',
  '/tmp/synthetic-build.log',
  '/var/lib/synthetic-app/state.json',
  'C:\\synthetic-work\\output.log',
  'path=/opt/synthetic-app/config.yaml',
];

describe('assertNoPII', () => {
  it.each(deniedFixtures)('rejects denied value %s', deniedValue => {
    expect(() => assertNoPII({ safe: 'value', deniedValue })).toThrow(
      'Telemetry payload contains denied data'
    );
  });

  it.each([
    'ai.location.country',
    'ai.location.province',
    'ai.location.city',
    'client_CountryOrRegion',
    'client_StateOrProvince',
    'client_City',
  ])('rejects denied geo key %s', deniedKey => {
    expect(() => assertNoPII({ [deniedKey]: 'synthetic' })).toThrow(
      'Telemetry payload contains denied data'
    );
  });

  it('rejects denied data embedded in object keys', () => {
    expect(() => assertNoPII({ '/subscriptions/synthetic-subscription': 'value' })).toThrow(
      'Telemetry payload contains denied data'
    );
  });

  it('rejects dynamic operation names and precise IP addresses', () => {
    expect(() =>
      assertNoPII({ tags: { 'ai.operation.name': '/projects/synthetic-cluster' } })
    ).toThrow('Telemetry payload contains denied data');
    expect(() => assertNoPII({ tags: { 'ai.location.ip': '203.0.113.42' } })).toThrow(
      'Telemetry payload contains denied data'
    );
  });

  it('accepts the closed categorical telemetry shape', () => {
    expect(() =>
      assertNoPII({
        name: 'headlamp.exception',
        properties: {
          area: 'kubernetes',
          errorClass: 'NetworkError',
          phase: 'failed',
        },
        tags: {
          'ai.operation.name': '/projects',
          'ai.location.ip': '0.0.0.0',
        },
      })
    ).not.toThrow();
  });

  it.each(['/index', '/login', '/profile', '/projects', '/settings'])(
    'accepts approved route bucket %s',
    route => {
      expect(() => assertNoPII({ route })).not.toThrow();
    }
  );
});

describe('scrubTelemetryData', () => {
  it('removes denied keys and values recursively without mutating its input', () => {
    const input = {
      safe: 'kept',
      url: 'https://example.invalid/customer',
      nested: {
        area: 'plugin-ui',
        path: '/home/synthetic-user/project',
        'ai.location.city': 'synthetic-city',
      },
      list: ['completed', '/managedClusters/synthetic-cluster'],
      '/home/synthetic-user/private': 'denied key',
      tags: {
        'ai.operation.name': '/projects/synthetic-cluster',
        'ai.location.ip': '203.0.113.42',
      },
    };

    expect(scrubTelemetryData(input)).toEqual({
      safe: 'kept',
      nested: { area: 'plugin-ui' },
      list: ['completed'],
      tags: {
        'ai.operation.name': 'unknown',
        'ai.location.ip': '0.0.0.0',
      },
    });
    expect(input.nested.path).toBe('/home/synthetic-user/project');
  });
});
