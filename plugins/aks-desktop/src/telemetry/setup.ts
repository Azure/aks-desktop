// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { registerHeadlampEventCallback } from '@kinvolk/headlamp-plugin/lib';
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { extractKindFromPayload } from './extractKind';
import { makePrivacyInitializer } from './privacy';
import { KNOWN_PLUGIN_IDS } from './schema';
import {
  type SessionStartProps,
  trackFeature,
  trackPluginsLoaded,
  trackSessionStart,
} from './track';

export interface EnableTelemetryOptions {
  /** App Insights connection string. Empty/missing → no-op. */
  connectionString: string | undefined;
  /** Per-install UUID. Undefined → no-op. We never ship without an ID. */
  installId: string | undefined;
  /** Properties for the initial `headlamp.session-start` event. */
  sessionProps: SessionStartProps;
  /**
   * Injection point for tests: register the per-event callback. Defaults
   * to the public plugin API `registerHeadlampEventCallback`. Tests can
   * pass a spy.
   */
  registerEventCallback?: (cb: (event: { type: string; data?: unknown }) => void) => void;
}

/**
 * Initialize App Insights and wire telemetry. Idempotent guards are not
 * built in — callers should invoke once per session.
 *
 * No-ops when telemetry is disabled (missing connection string, missing
 * install ID, or both). In that case, no SDK instance is created,
 * `window.appInsights` is left untouched, and no envelopes can be sent.
 */
export function enableTelemetry(opts: EnableTelemetryOptions): void {
  if (!opts.connectionString || !opts.installId) {
    return;
  }

  const ai = new ApplicationInsights({
    config: {
      connectionString: opts.connectionString,
      // Defense in depth: mirror PR #626's lockdown of auto-collection.
      disableFetchTracking: true,
      disableAjaxTracking: true,
      disableExceptionTracking: true,
      disableCookiesUsage: true,
      isStorageUseDisabled: true,
      enableAutoRouteTracking: false,
    },
  });

  ai.addTelemetryInitializer(makePrivacyInitializer(opts.installId));
  ai.loadAppInsights();
  window.appInsights = ai;

  // First event after init.
  trackSessionStart(opts.sessionProps);

  // Forward redux events as telemetry.
  const register =
    opts.registerEventCallback ??
    (registerHeadlampEventCallback as unknown as (
      cb: (event: { type: string; data?: unknown }) => void
    ) => void);
  register(event => {
    try {
      if (event.type === 'headlamp.plugins-loaded') {
        const plugins =
          (event.data as { plugins?: Array<{ name: string; isEnabled: boolean }> } | undefined)
            ?.plugins ?? [];
        const enabled = plugins.filter(p => p.isEnabled);
        const knownEnabledIds = enabled.map(p => p.name).filter(n => KNOWN_PLUGIN_IDS.has(n));
        const thirdPartyCount = enabled.filter(p => !KNOWN_PLUGIN_IDS.has(p.name)).length;
        trackPluginsLoaded({
          totalCount: plugins.length,
          enabledCount: enabled.length,
          knownEnabledIds,
          thirdPartyCount,
        });
        return;
      }
      trackFeature({
        feature: event.type,
        status: (event.data as { status?: string } | undefined)?.status ?? 'unknown',
        resourceKind: extractKindFromPayload(event),
      });
    } catch (e) {
      // Never let telemetry break the app.
      // eslint-disable-next-line no-console
      console.error('Failed to forward event as telemetry', e);
    }
  });
}
