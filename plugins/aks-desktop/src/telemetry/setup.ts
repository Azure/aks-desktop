// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { registerHeadlampEventCallback } from '@kinvolk/headlamp-plugin/lib';
import {
  type HeadlampEvent,
  HeadlampEventType,
} from '@kinvolk/headlamp-plugin/lib/redux/headlampEventSlice';
import { trackFeature, trackPluginsLoaded } from './index';
import { KNOWN_PLUGIN_IDS, sanitizeKind } from './schema';

/**
 * Redux event types allowed to forward as `headlamp.feature` envelopes.
 * Verified by snapshot test so each addition is reviewed alongside the
 * privacy posture. ERROR_BOUNDARY is omitted — TelemetryErrorBoundary
 * calls trackException directly.
 */
export const TELEMETRY_EVENT_ALLOWLIST: ReadonlySet<string> = new Set([
  HeadlampEventType.DELETE_RESOURCE,
  HeadlampEventType.DELETE_RESOURCES,
  HeadlampEventType.CREATE_RESOURCE,
  HeadlampEventType.EDIT_RESOURCE,
  HeadlampEventType.SCALE_RESOURCE,
  HeadlampEventType.RESTART_RESOURCE,
  HeadlampEventType.RESTART_RESOURCES,
  'headlamp.rollback-resource', // enum member missing in installed type
  HeadlampEventType.LOGS,
  HeadlampEventType.TERMINAL,
  HeadlampEventType.POD_ATTACH,
  HeadlampEventType.PLUGIN_LOADING_ERROR,
  HeadlampEventType.PLUGINS_LOADED,
  HeadlampEventType.DETAILS_VIEW,
  HeadlampEventType.LIST_VIEW,
  HeadlampEventType.OBJECT_EVENTS,
]);

/**
 * Forward HeadlampEvents as telemetry envelopes. PLUGINS_LOADED routes
 * to trackPluginsLoaded; other allowlisted types route to trackFeature;
 * everything else is dropped silently.
 */
export function registerReduxCallback(): void {
  registerHeadlampEventCallback((event: HeadlampEvent) => {
    try {
      if (!TELEMETRY_EVENT_ALLOWLIST.has(event.type)) return;

      if (event.type === HeadlampEventType.PLUGINS_LOADED) {
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
        resourceKind: extractKindFromPayload({ type: event.type, data: event.data }),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[aksd-telemetry] callback failed:', e);
    }
  });
}

/**
 * Extract a sanitized resourceKind from a HeadlampEvent payload. Returns
 * undefined when the event carries no resource. Plural events return the
 * single kind if homogeneous, else "Multiple" — never enumerated.
 */
export function extractKindFromPayload(event: { type: string; data?: any }): string | undefined {
  const { type, data } = event;

  switch (type) {
    case HeadlampEventType.LOGS:
    case HeadlampEventType.TERMINAL:
    case HeadlampEventType.POD_ATTACH:
      return 'Pod';

    case HeadlampEventType.LIST_VIEW:
      return data?.resourceKind ? sanitizeKind(data.resourceKind) : undefined;

    case HeadlampEventType.DELETE_RESOURCE:
    case HeadlampEventType.EDIT_RESOURCE:
    case HeadlampEventType.SCALE_RESOURCE:
    case HeadlampEventType.RESTART_RESOURCE:
    case 'headlamp.rollback-resource':
    case HeadlampEventType.DETAILS_VIEW:
      return data?.resource?.kind ? sanitizeKind(data.resource.kind) : undefined;

    case HeadlampEventType.DELETE_RESOURCES:
    case HeadlampEventType.RESTART_RESOURCES: {
      const resources = data?.resources;
      if (!Array.isArray(resources) || resources.length === 0) return undefined;
      // Per the function contract, if any entry lacks a kind we cannot
      // honestly describe the batch — return undefined rather than
      // bucketing some entries into "Unknown"/"CustomResource".
      if (resources.some((r: any) => !r?.kind)) return undefined;
      // Compare raw kinds for homogeneity so two distinct CRD kinds
      // ("FooResource" vs "BarResource") aren't falsely collapsed to
      // the same "CustomResource" bucket by sanitizeKind.
      const firstRaw: string = resources[0].kind;
      const homogeneous = resources.every((r: any) => r.kind === firstRaw);
      return homogeneous ? sanitizeKind(firstRaw) : 'Multiple';
    }

    case HeadlampEventType.OBJECT_EVENTS:
      return data?.resource?.kind ? sanitizeKind(data.resource.kind) : undefined;

    case HeadlampEventType.ERROR_BOUNDARY:
    case HeadlampEventType.CREATE_RESOURCE:
    case HeadlampEventType.PLUGINS_LOADED:
    case HeadlampEventType.PLUGIN_LOADING_ERROR:
      return undefined;

    default:
      return undefined;
  }
}
