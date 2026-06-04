// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ITelemetryItem } from '@microsoft/applicationinsights-web';
import { describe, expect, it } from 'vitest';
import { makePrivacyInitializer } from './privacy';

const VALID_INSTALL_ID = '11111111-1111-4111-8111-111111111111';

// `envelope.name` is the SDK-internal envelope-type identifier (e.g.
// `Microsoft.ApplicationInsights.<ikey>.Event`), NOT the caller-controlled
// custom event name passed to `trackEvent({ name })`. The custom name
// lives at `envelope.data.baseData.name`. The test fixtures mirror real
// SDK shape: a sentinel SDK type at the top level, and the caller's name
// nested under baseData.
const SDK_EVENT_TYPE = 'Microsoft.ApplicationInsights.fakeikey.Event';

function envelope(overrides: {
  tags?: ITelemetryItem['tags'];
  baseData?: Record<string, unknown>;
}) {
  const out: ITelemetryItem = {
    name: SDK_EVENT_TYPE,
    baseType: 'EventData',
    tags: overrides.tags,
    data: overrides.baseData ? { baseData: overrides.baseData } : undefined,
  } as ITelemetryItem;
  return out;
}

function baseDataWithName(name: string, extra: Record<string, unknown> = {}) {
  return { name, ...extra };
}

describe('privacy initializer', () => {
  it('strips ai.user.authUserId, ai.user.accountId, ai.session.id, ai.location.ip', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({
      tags: {
        'ai.user.authUserId': 'jdoe@example.com',
        'ai.user.accountId': 'acct-123',
        'ai.session.id': 'sess-xyz',
        'ai.location.ip': '198.51.100.1',
      },
      baseData: baseDataWithName('headlamp.feature'),
    });
    init(e);
    expect(e.tags).not.toHaveProperty('ai.user.authUserId');
    expect(e.tags).not.toHaveProperty('ai.user.accountId');
    expect(e.tags).not.toHaveProperty('ai.session.id');
    expect(e.tags).not.toHaveProperty('ai.location.ip');
  });

  it('keeps ai.user.id when it equals the install UUID', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({
      tags: { 'ai.user.id': VALID_INSTALL_ID },
      baseData: baseDataWithName('headlamp.feature'),
    });
    init(e);
    expect(e.tags?.['ai.user.id']).toBe(VALID_INSTALL_ID);
  });

  it('stamps install UUID into ai.user.id when missing', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({ baseData: baseDataWithName('headlamp.feature') });
    init(e);
    expect(e.tags?.['ai.user.id']).toBe(VALID_INSTALL_ID);
  });

  it('replaces non-UUID ai.user.id with the install UUID', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({
      tags: { 'ai.user.id': 'jdoe@example.com' },
      baseData: baseDataWithName('headlamp.feature'),
    });
    init(e);
    expect(e.tags?.['ai.user.id']).toBe(VALID_INSTALL_ID);
  });

  it('strips ai.user.id entirely when no install UUID provided', () => {
    const init = makePrivacyInitializer(undefined);
    const e = envelope({
      tags: { 'ai.user.id': 'something' },
      baseData: baseDataWithName('headlamp.feature'),
    });
    init(e);
    expect(e.tags).not.toHaveProperty('ai.user.id');
  });

  it('clears uri/refUri/url on baseData', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({
      baseData: {
        name: 'headlamp.feature',
        uri: 'https://x/clusters/prod/pods/secret-thing',
        refUri: 'https://x/anywhere',
        url: 'https://y',
      },
    });
    init(e);
    const bd = (e.data?.baseData ?? {}) as Record<string, unknown>;
    expect(bd.uri).toBe('');
    expect(bd.refUri).toBe('');
    expect(bd.url).toBe('');
  });

  it('drops properties whose keys are not in KNOWN_PROPERTY_KEYS', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({
      baseData: {
        name: 'headlamp.feature',
        properties: {
          installId: VALID_INSTALL_ID,
          errorName: 'TypeError',
          attackerInjected: 'secret value',
          anotherBadKey: '12345',
        },
      },
    });
    init(e);
    const props = (e.data?.baseData as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty('installId');
    expect(props).toHaveProperty('errorName');
    expect(props).not.toHaveProperty('attackerInjected');
    expect(props).not.toHaveProperty('anotherBadKey');
  });

  it('does not throw when envelope has no baseData', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e: ITelemetryItem = { name: SDK_EVENT_TYPE } as ITelemetryItem;
    expect(() => init(e)).not.toThrow();
    expect(e.tags?.['ai.user.id']).toBe(VALID_INSTALL_ID);
  });

  it('keeps baseData.name (the custom event name) when it is in KNOWN_EVENT_NAMES', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    for (const name of [
      'headlamp.session-start',
      'headlamp.cluster-shape',
      'headlamp.feature',
      'headlamp.exception',
      'headlamp.plugins-loaded',
      'exception',
    ]) {
      const e = envelope({ baseData: baseDataWithName(name) });
      init(e);
      expect((e.data?.baseData as { name: string }).name).toBe(name);
      // SDK-internal envelope type is left untouched.
      expect(e.name).toBe(SDK_EVENT_TYPE);
    }
  });

  it('replaces baseData.name with "unknown" when not in KNOWN_EVENT_NAMES', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({ baseData: baseDataWithName('leak:secret-value') });
    init(e);
    expect((e.data?.baseData as { name: string }).name).toBe('unknown');
    // SDK-internal envelope type is left untouched.
    expect(e.name).toBe(SDK_EVENT_TYPE);
  });

  it('replaces baseData.name with "unknown" when missing', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({ baseData: { properties: { errorName: 'TypeError' } } });
    init(e);
    expect((e.data?.baseData as { name: string }).name).toBe('unknown');
  });
});
