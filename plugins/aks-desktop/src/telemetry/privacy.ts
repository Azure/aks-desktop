// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ITelemetryItem } from '@microsoft/applicationinsights-web';
import { KNOWN_PROPERTY_KEYS } from './schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the privacy telemetry initializer, closing over the install UUID
 * (or `undefined` if telemetry is configured without one — e.g. web
 * fallback).
 *
 * For every outgoing envelope, this is the LAST line of defense:
 *
 *   1. Strip the unconditional fields (auth/account/session/IP).
 *   2. Replace `ai.user.id` with the install UUID if we have one and the
 *      current value doesn't match; strip it entirely if we don't.
 *   3. Clear URL fields on baseData.
 *   4. Drop any property key not in KNOWN_PROPERTY_KEYS.
 *
 * Mutates `envelope` in place (initializer contract).
 */
export function makePrivacyInitializer(installId: string | undefined) {
  return function privacyTelemetryInitializer(envelope: ITelemetryItem): void {
    envelope.tags = envelope.tags ?? {};
    delete envelope.tags['ai.user.authUserId'];
    delete envelope.tags['ai.user.accountId'];
    delete envelope.tags['ai.session.id'];
    delete envelope.tags['ai.location.ip'];

    const currentUserId = envelope.tags['ai.user.id'];
    if (installId) {
      if (typeof currentUserId !== 'string' || !UUID_RE.test(currentUserId)) {
        envelope.tags['ai.user.id'] = installId;
      }
    } else {
      delete envelope.tags['ai.user.id'];
    }

    const baseData = envelope.data?.baseData as Record<string, unknown> | undefined;
    if (baseData) {
      if ('uri' in baseData) baseData.uri = '';
      if ('refUri' in baseData) baseData.refUri = '';
      if ('url' in baseData) baseData.url = '';

      const props = baseData.properties as Record<string, unknown> | undefined;
      if (props) {
        for (const key of Object.keys(props)) {
          if (!KNOWN_PROPERTY_KEYS.has(key)) {
            delete props[key];
          }
        }
      }
    }
  };
}
