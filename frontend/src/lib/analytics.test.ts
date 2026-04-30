/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ITelemetryItem } from '@microsoft/applicationinsights-web';
import { describe, expect, it } from 'vitest';
import { privacyTelemetryInitializer } from './analyticsPrivacy';

function makeEnvelope(overrides: Partial<ITelemetryItem> = {}): ITelemetryItem {
  return {
    name: 'Microsoft.ApplicationInsights.Event',
    time: new Date().toISOString(),
    ...overrides,
  } as ITelemetryItem;
}

describe('privacyTelemetryInitializer', () => {
  it('removes identifying tags', () => {
    const envelope = makeEnvelope({
      tags: {
        'ai.user.id': 'user-abc',
        'ai.user.authUserId': 'auth-xyz',
        'ai.user.accountId': 'account-42',
        'ai.session.id': 'session-99',
        'ai.location.ip': '203.0.113.5',
        'ai.cloud.role': 'web', // benign tag — should be preserved
      },
    });

    privacyTelemetryInitializer(envelope);

    expect(envelope.tags).toEqual({ 'ai.cloud.role': 'web' });
  });

  it('clears uri, refUri, and url fields on baseData', () => {
    const envelope = makeEnvelope({
      data: {
        baseData: {
          uri: 'https://example.test/c/prod/namespaces/payments/pods/secret',
          refUri: 'https://example.test/login',
          url: 'https://example.test/api',
          name: 'page-name', // unrelated field — should be preserved
        },
      },
    });

    privacyTelemetryInitializer(envelope);

    const baseData = envelope.data!.baseData as Record<string, unknown>;
    expect(baseData.uri).toBe('');
    expect(baseData.refUri).toBe('');
    expect(baseData.url).toBe('');
    expect(baseData.name).toBe('page-name');
  });

  it('handles envelopes without tags or baseData', () => {
    const envelope = makeEnvelope();
    expect(() => privacyTelemetryInitializer(envelope)).not.toThrow();
    expect(envelope.tags).toEqual({});
  });

  it('does not add fields that were not already present on baseData', () => {
    const envelope = makeEnvelope({
      data: { baseData: { name: 'evt' } },
    });

    privacyTelemetryInitializer(envelope);

    const baseData = envelope.data!.baseData as Record<string, unknown>;
    expect('uri' in baseData).toBe(false);
    expect('refUri' in baseData).toBe(false);
    expect('url' in baseData).toBe(false);
  });
});
