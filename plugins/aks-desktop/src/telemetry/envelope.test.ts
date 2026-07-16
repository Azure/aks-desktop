// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { IPayloadData, IXHROverride } from '@microsoft/applicationinsights-core-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __flushForTests,
  __resetForTests,
  __setTransportOverrideForTests,
  initTelemetry,
  setTelemetryEnabled,
  trackError,
  trackFeature,
} from './index';
import { assertNoPII } from './privacy';

const SYNTHETIC_CONNECTION_STRING =
  'InstrumentationKey=11111111-1111-4111-8111-111111111111;IngestionEndpoint=https://synthetic.invalid/';

function decodePayload(data: IPayloadData['data']): string {
  return typeof data === 'string' ? data : new TextDecoder().decode(data);
}

describe('real Application Insights envelope', () => {
  beforeEach(() => {
    __resetForTests();
    setTelemetryEnabled(true);
    window.history.replaceState({}, '', '/projects/synthetic-customer?subscription=synthetic');
  });

  it('scrubs the final serialized pre-transport batch', async () => {
    const batches: string[] = [];
    const transport: IXHROverride = {
      sendPOST(payload, oncomplete) {
        batches.push(decodePayload(payload.data));
        oncomplete(200, {}, '');
      },
    };
    __setTransportOverrideForTests(transport);
    initTelemetry({
      connectionString: SYNTHETIC_CONNECTION_STRING,
      installId: '11111111-1111-4111-8111-111111111111',
      sessionProps: {
        appVersion: '1.0.0-test',
        headlampVersion: '0.0.0-test',
        locale: 'en-US',
        os: 'linux',
        arch: 'x64',
        electronVersion: '0.0.0-test',
      },
    });
    trackFeature({ feature: 'headlamp.logs', status: 'opened' });
    trackError({ area: 'deploy', errorClass: 'NetworkError', phase: 'failed' });
    await __flushForTests();

    expect(batches).toHaveLength(1);
    const serializedBatch = JSON.parse(batches[0]);
    assertNoPII(serializedBatch);
    const featureEnvelope = serializedBatch.find(
      (envelope: { data?: { baseData?: { name?: string } } }) =>
        envelope.data?.baseData?.name === 'headlamp.feature'
    );
    expect(featureEnvelope.tags['ai.operation.name']).toBe('unknown');
    expect(featureEnvelope.tags['ai.location.ip']).toBe('0.0.0.0');
    expect(featureEnvelope.data.baseData.properties).toEqual({
      feature: 'headlamp.logs',
      status: 'opened',
    });
    const errorEnvelope = serializedBatch.find(
      (envelope: { data?: { baseData?: { name?: string } } }) =>
        envelope.data?.baseData?.name === 'headlamp.exception'
    );
    expect(errorEnvelope.data.baseData.properties).toEqual({
      appVersion: '1.0.0-test',
      area: 'deploy',
      errorClass: 'NetworkError',
      phase: 'failed',
    });
  });
});
