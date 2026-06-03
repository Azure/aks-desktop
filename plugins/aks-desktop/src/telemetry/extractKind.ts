// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { HeadlampEventType } from '@kinvolk/headlamp-plugin/lib/redux/headlampEventSlice';
import { sanitizeKind } from './schema';

/**
 * Extract a sanitized resourceKind from a HeadlampEvent payload.
 *
 * Returns `undefined` when the event has no resource — callers omit the
 * property from the envelope rather than sending an empty string.
 *
 * Plural-resource events return the single kind when every element shares
 * it, otherwise `"Multiple"`. We never enumerate the kinds — `Multiple` is
 * a fixed-vocabulary value.
 */
export function extractKindFromPayload(event: { type: string; data?: any }): string | undefined {
  const { type, data } = event;

  switch (type) {
    case HeadlampEventType.LOGS:
    case HeadlampEventType.TERMINAL:
    case HeadlampEventType.POD_ATTACH:
      return 'Pod';

    case HeadlampEventType.LIST_VIEW:
      return sanitizeKind(data?.resourceKind);

    case HeadlampEventType.DELETE_RESOURCE:
    case HeadlampEventType.EDIT_RESOURCE:
    case HeadlampEventType.SCALE_RESOURCE:
    case HeadlampEventType.RESTART_RESOURCE:
    case 'headlamp.rollback-resource': // enum member missing in installed type, dispatched at runtime by the fork
    case HeadlampEventType.DETAILS_VIEW:
      return sanitizeKind(data?.resource?.kind);

    case HeadlampEventType.DELETE_RESOURCES:
    case HeadlampEventType.RESTART_RESOURCES: {
      const resources = data?.resources;
      if (!Array.isArray(resources) || resources.length === 0) return undefined;
      const first = sanitizeKind(resources[0]?.kind);
      const homogeneous = resources.every((r: any) => sanitizeKind(r?.kind) === first);
      return homogeneous ? first : 'Multiple';
    }

    case HeadlampEventType.OBJECT_EVENTS:
      return data?.resource ? sanitizeKind(data.resource.kind) : undefined;

    case HeadlampEventType.ERROR_BOUNDARY:
    case HeadlampEventType.CREATE_RESOURCE:
    case HeadlampEventType.PLUGINS_LOADED:
    case HeadlampEventType.PLUGIN_LOADING_ERROR:
      return undefined;

    default:
      return undefined;
  }
}
