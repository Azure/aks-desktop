// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect } from 'react';
import { trackAksFeature } from '../telemetry/aksFeature';
import type { AksFeatureType } from '../telemetry/schema';

export function useTelemetryFeatureOpened(feature: AksFeatureType): void {
  useEffect(() => {
    trackAksFeature(feature, 'opened');
  }, [feature]);
}
