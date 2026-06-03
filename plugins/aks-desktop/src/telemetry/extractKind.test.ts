// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { HeadlampEventType } from '@kinvolk/headlamp-plugin/lib/redux/headlampEventSlice';
import { describe, expect, it } from 'vitest';
import { extractKindFromPayload } from './extractKind';

const podResource = { kind: 'Pod' } as any;
const deploymentResource = { kind: 'Deployment' } as any;
const crdResource = { kind: 'ArgoApplication' } as any;

describe('extractKindFromPayload', () => {
  it('returns "Pod" for LOGS/TERMINAL/POD_ATTACH unconditionally', () => {
    expect(extractKindFromPayload({ type: HeadlampEventType.LOGS, data: {} })).toBe('Pod');
    expect(extractKindFromPayload({ type: HeadlampEventType.TERMINAL, data: {} })).toBe('Pod');
    expect(extractKindFromPayload({ type: HeadlampEventType.POD_ATTACH, data: {} })).toBe('Pod');
  });

  it('returns sanitized kind from data.resource for single-resource events', () => {
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.DELETE_RESOURCE,
        data: { resource: deploymentResource, status: 'confirmed' },
      })
    ).toBe('Deployment');
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.EDIT_RESOURCE,
        data: { resource: crdResource, status: 'open' },
      })
    ).toBe('CustomResource');
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.SCALE_RESOURCE,
        data: { resource: podResource, status: 'confirmed' },
      })
    ).toBe('Pod');
  });

  it('returns sanitized kind from data.resourceKind for LIST_VIEW', () => {
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.LIST_VIEW,
        data: { resources: [], resourceKind: 'Pod' },
      })
    ).toBe('Pod');
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.LIST_VIEW,
        data: { resources: [], resourceKind: 'CustomThing' },
      })
    ).toBe('CustomResource');
  });

  it('returns homogeneous kind for plural events when all elements match', () => {
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.DELETE_RESOURCES,
        data: { resources: [podResource, podResource, podResource], status: 'confirmed' },
      })
    ).toBe('Pod');
  });

  it('returns "Multiple" for plural events with mixed kinds', () => {
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.DELETE_RESOURCES,
        data: { resources: [podResource, deploymentResource], status: 'confirmed' },
      })
    ).toBe('Multiple');
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.RESTART_RESOURCES,
        data: { resources: [podResource, deploymentResource], status: 'confirmed' },
      })
    ).toBe('Multiple');
  });

  it('returns undefined for events with no resource (CREATE_RESOURCE, PLUGINS_LOADED, etc.)', () => {
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.CREATE_RESOURCE,
        data: { status: 'confirmed' },
      })
    ).toBeUndefined();
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.PLUGINS_LOADED,
        data: { plugins: [] },
      })
    ).toBeUndefined();
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.PLUGIN_LOADING_ERROR,
        data: { pluginInfo: { name: 'x', version: '1' }, error: new Error('x') },
      })
    ).toBeUndefined();
  });

  it('returns undefined for OBJECT_EVENTS when resource missing, sanitized kind when present', () => {
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.OBJECT_EVENTS,
        data: { events: [] },
      })
    ).toBeUndefined();
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.OBJECT_EVENTS,
        data: { events: [], resource: podResource },
      })
    ).toBe('Pod');
  });

  it('returns undefined for unknown event types', () => {
    expect(extractKindFromPayload({ type: 'not-a-real-event', data: {} } as any)).toBeUndefined();
  });

  it('returns "Unknown" when single-resource event has missing resource', () => {
    expect(
      extractKindFromPayload({
        type: HeadlampEventType.DELETE_RESOURCE,
        data: { status: 'confirmed' } as any,
      })
    ).toBe('Unknown');
  });

  it('returns sanitized kind for rollback-resource (string literal — type lag in installed plugin pkg)', () => {
    expect(
      extractKindFromPayload({
        type: 'headlamp.rollback-resource',
        data: { resource: { kind: 'Deployment' }, status: 'confirmed' },
      } as any)
    ).toBe('Deployment');
  });
});
