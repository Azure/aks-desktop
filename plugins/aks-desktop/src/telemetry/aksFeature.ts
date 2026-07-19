// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { trackFeature } from './index';
import type { AksFeatureType, TelemetryStatus } from './schema';

export type AksFeatureLifecycleStatus = Extract<
  TelemetryStatus,
  'opened' | 'started' | 'succeeded' | 'failed' | 'cancelled'
>;

export function trackAksFeature(feature: AksFeatureType, status: AksFeatureLifecycleStatus): void {
  try {
    trackFeature({ feature, status });
  } catch {
    // Telemetry must never affect the workflow being measured.
  }
}
