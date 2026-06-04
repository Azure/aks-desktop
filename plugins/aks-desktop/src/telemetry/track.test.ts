// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackException, trackFeature, trackPluginsLoaded, trackSessionStart } from './track';

let trackEventMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  trackEventMock = vi.fn();
  window.appInsights = { trackEvent: trackEventMock } as unknown as ApplicationInsights;
});

afterEach(() => {
  window.appInsights = undefined;
});

describe('trackSessionStart', () => {
  it('builds the session-start envelope with sanitized fields', () => {
    trackSessionStart({
      installId: '11111111-1111-4111-8111-111111111111',
      appVersion: '1.4.2',
      headlampVersion: '0.27.0',
      electronVersion: '30.0.0',
      os: 'darwin',
      osMajor: '14.5.0',
      arch: 'arm64',
      locale: 'en-US',
    });
    expect(trackEventMock).toHaveBeenCalledWith({
      name: 'headlamp.session-start',
      properties: {
        installId: '11111111-1111-4111-8111-111111111111',
        appVersion: '1.4.2',
        headlampVersion: '0.27.0',
        electronVersion: '30.0.0',
        os: 'darwin',
        osMajor: '14',
        arch: 'arm64',
        locale: 'en',
      },
    });
  });

  it('drops extra properties passed via as-any cast', () => {
    trackSessionStart({
      installId: '11111111-1111-4111-8111-111111111111',
      appVersion: '1.4.2',
      headlampVersion: '0.27.0',
      electronVersion: '30.0.0',
      os: 'linux',
      osMajor: '6',
      arch: 'x64',
      locale: 'ja',
      attackerSneakedThis: 'secret value',
    } as any);
    const props = trackEventMock.mock.calls[0][0].properties;
    expect(props).not.toHaveProperty('attackerSneakedThis');
  });
});

describe('trackFeature', () => {
  it('builds the feature envelope with sanitized kind', () => {
    trackFeature({
      feature: 'headlamp.delete-resource',
      status: 'confirmed',
      resourceKind: 'Pod',
    });
    expect(trackEventMock).toHaveBeenCalledWith({
      name: 'headlamp.feature',
      properties: {
        feature: 'headlamp.delete-resource',
        status: 'confirmed',
        resourceKind: 'Pod',
      },
    });
  });

  it('omits resourceKind when undefined', () => {
    trackFeature({ feature: 'headlamp.create-resource', status: 'confirmed' });
    const props = trackEventMock.mock.calls[0][0].properties;
    expect(props).not.toHaveProperty('resourceKind');
  });

  it('re-sanitizes resourceKind even if caller bypassed extractKind', () => {
    trackFeature({
      feature: 'headlamp.delete-resource',
      status: 'confirmed',
      resourceKind: 'MyCRD' as any,
    });
    expect(trackEventMock.mock.calls[0][0].properties.resourceKind).toBe('CustomResource');
  });
});

describe('trackException', () => {
  it('builds the exception envelope with sanitized errorName', () => {
    trackException({ errorName: 'TypeError' });
    expect(trackEventMock).toHaveBeenCalledWith({
      name: 'headlamp.exception',
      properties: { errorName: 'TypeError' },
    });
  });
  it('collapses unknown errorName to Other', () => {
    trackException({ errorName: 'WeirdCustomError' });
    expect(trackEventMock.mock.calls[0][0].properties.errorName).toBe('Other');
  });
});

describe('trackPluginsLoaded', () => {
  it('builds the plugins-loaded envelope, keeping only first-party IDs', () => {
    trackPluginsLoaded({
      totalCount: 3,
      enabledCount: 2,
      knownEnabledIds: ['aks-desktop'],
      thirdPartyCount: 1,
    });
    expect(trackEventMock).toHaveBeenCalledWith({
      name: 'headlamp.plugins-loaded',
      properties: {
        totalCount: '3',
        enabledCount: '2',
        knownEnabledIds: 'aks-desktop',
        thirdPartyCount: '1',
      },
    });
  });
});

describe('no-op behavior', () => {
  it('all helpers no-op when window.appInsights is undefined', () => {
    // trackEventMock is installed by the file-level beforeEach. Unsetting
    // window.appInsights here means emit() returns before calling it, so
    // the mock should record zero calls.
    window.appInsights = undefined;
    trackSessionStart({
      installId: '11111111-1111-4111-8111-111111111111',
      appVersion: '1.4.2',
      headlampVersion: '0.27.0',
      electronVersion: '30.0.0',
      os: 'darwin',
      osMajor: '14',
      arch: 'arm64',
      locale: 'en',
    });
    trackFeature({ feature: 'headlamp.delete-resource', status: 'unknown' });
    trackException({ errorName: 'TypeError' });
    trackPluginsLoaded({ totalCount: 0, enabledCount: 0, knownEnabledIds: [], thirdPartyCount: 0 });
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it('trackFeature drops events whose feature is not in KNOWN_FEATURE_TYPES', () => {
    trackFeature({ feature: 'not.a.real.event', status: 'confirmed' });
    expect(trackEventMock).not.toHaveBeenCalled();
  });
});
