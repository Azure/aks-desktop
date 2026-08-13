// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useSyncExternalStore } from 'react';
import { getConsentEpoch, subscribeConsentEpoch } from '../telemetry/consent';

/**
 * The current consent epoch, incremented once per completed grant. Data-
 * driven telemetry producers (effects that emit only when their input data
 * changes, never on consent alone) include this value in their dependency
 * array so a mid-session grant re-runs them instead of leaving their data
 * unreported until something else happens to change.
 */
export function useConsentEpoch(): number {
  return useSyncExternalStore(subscribeConsentEpoch, getConsentEpoch, getConsentEpoch);
}
