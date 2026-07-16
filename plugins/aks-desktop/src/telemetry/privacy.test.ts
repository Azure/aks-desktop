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
    };

    expect(scrubTelemetryData(input)).toEqual({
      safe: 'kept',
      nested: { area: 'plugin-ui' },
      list: ['completed'],
    });
    expect(input.nested.path).toBe('/home/synthetic-user/project');
  });
});
