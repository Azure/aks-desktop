// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ITelemetryItem } from '@microsoft/applicationinsights-web';
import { describe, expect, it } from 'vitest';
import { makePrivacyInitializer } from './privacy';

const VALID_INSTALL_ID = '11111111-1111-4111-8111-111111111111';

function envelope(overrides: Partial<ITelemetryItem> = {}): ITelemetryItem {
  return { name: 'headlamp.feature', ...overrides } as ITelemetryItem;
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
    });
    init(e);
    expect(e.tags).not.toHaveProperty('ai.user.authUserId');
    expect(e.tags).not.toHaveProperty('ai.user.accountId');
    expect(e.tags).not.toHaveProperty('ai.session.id');
    expect(e.tags).not.toHaveProperty('ai.location.ip');
  });

  it('keeps ai.user.id when it equals the install UUID', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({ tags: { 'ai.user.id': VALID_INSTALL_ID } });
    init(e);
    expect(e.tags?.['ai.user.id']).toBe(VALID_INSTALL_ID);
  });

  it('stamps install UUID into ai.user.id when missing', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope();
    init(e);
    expect(e.tags?.['ai.user.id']).toBe(VALID_INSTALL_ID);
  });

  it('replaces non-UUID ai.user.id with the install UUID', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({ tags: { 'ai.user.id': 'jdoe@example.com' } });
    init(e);
    expect(e.tags?.['ai.user.id']).toBe(VALID_INSTALL_ID);
  });

  it('strips ai.user.id entirely when no install UUID provided', () => {
    const init = makePrivacyInitializer(undefined);
    const e = envelope({ tags: { 'ai.user.id': 'something' } });
    init(e);
    expect(e.tags).not.toHaveProperty('ai.user.id');
  });

  it('clears uri/refUri/url on baseData', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e = envelope({
      data: {
        baseData: {
          uri: 'https://x/clusters/prod/pods/secret-thing',
          refUri: 'https://x/anywhere',
          url: 'https://y',
        },
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
      data: {
        baseData: {
          properties: {
            installId: VALID_INSTALL_ID,
            errorName: 'TypeError',
            attackerInjected: 'secret value',
            anotherBadKey: '12345',
          },
        },
      },
    });
    init(e);
    const props = (e.data?.baseData as any).properties;
    expect(props).toHaveProperty('installId');
    expect(props).toHaveProperty('errorName');
    expect(props).not.toHaveProperty('attackerInjected');
    expect(props).not.toHaveProperty('anotherBadKey');
  });

  it('is a no-op when envelope has neither tags nor baseData', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e: ITelemetryItem = { name: 'headlamp.feature' } as ITelemetryItem;
    expect(() => init(e)).not.toThrow();
    expect(e.tags?.['ai.user.id']).toBe(VALID_INSTALL_ID);
  });

  it('keeps envelope name when it is in KNOWN_EVENT_NAMES', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    for (const name of [
      'headlamp.session-start',
      'headlamp.cluster-shape',
      'headlamp.feature',
      'headlamp.exception',
      'headlamp.plugins-loaded',
      'exception',
    ]) {
      const e: ITelemetryItem = { name } as ITelemetryItem;
      init(e);
      expect(e.name).toBe(name);
    }
  });

  it('replaces envelope name with "unknown" when not in KNOWN_EVENT_NAMES', () => {
    const init = makePrivacyInitializer(VALID_INSTALL_ID);
    const e: ITelemetryItem = { name: 'leak:secret-value' } as ITelemetryItem;
    init(e);
    expect(e.name).toBe('unknown');
  });
});
