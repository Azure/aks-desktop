// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, test } from 'vitest';
import type { ClusterState } from './clusterState';
import { getClusterStateLabel, isAksHybridEdgeOnline, isClusterFailed } from './clusterState';

const MANAGED: ClusterState = { clusterType: 'aks', provisioningState: 'Succeeded' };
const ARC_ONLINE: ClusterState = {
  clusterType: 'aksarc',
  provisioningState: 'Succeeded',
  connectivityStatus: 'Connected',
};
const ARC_OFFLINE: ClusterState = { ...ARC_ONLINE, connectivityStatus: 'Offline' };

describe('isAksHybridEdgeOnline', () => {
  test('managed clusters are always online — they carry no heartbeat', () => {
    expect(isAksHybridEdgeOnline(MANAGED)).toBe(true);
    expect(isAksHybridEdgeOnline({ provisioningState: 'Succeeded' })).toBe(true);
  });

  test('an Arc cluster is online only when its agent reports Connected', () => {
    expect(isAksHybridEdgeOnline(ARC_ONLINE)).toBe(true);
    expect(isAksHybridEdgeOnline(ARC_OFFLINE)).toBe(false);
    expect(isAksHybridEdgeOnline({ ...ARC_ONLINE, connectivityStatus: 'Expired' })).toBe(false);
    expect(isAksHybridEdgeOnline({ ...ARC_ONLINE, connectivityStatus: undefined })).toBe(false);
  });
});

describe('isClusterFailed', () => {
  test('matches a Failed provisioning state case-insensitively', () => {
    expect(isClusterFailed({ ...MANAGED, provisioningState: 'Failed' })).toBe(true);
    expect(isClusterFailed({ ...MANAGED, provisioningState: 'FAILED' })).toBe(true);
  });

  test('is false for any other provisioning state', () => {
    expect(isClusterFailed(MANAGED)).toBe(false);
    expect(isClusterFailed({ ...MANAGED, provisioningState: 'Updating' })).toBe(false);
  });
});

describe('getClusterStateLabel', () => {
  test('shows the provisioning state for healthy clusters', () => {
    expect(getClusterStateLabel(MANAGED)).toBe('Succeeded');
    expect(getClusterStateLabel(ARC_ONLINE)).toBe('Succeeded');
  });

  test('shows the heartbeat for an offline Arc cluster, not its stale Succeeded state', () => {
    // The regression this guards: an Arc cluster's provisioningState is frozen at
    // Succeeded from creation onward, so an offline cluster read as healthy.
    expect(getClusterStateLabel(ARC_OFFLINE)).toBe('Offline');
    expect(getClusterStateLabel({ ...ARC_OFFLINE, connectivityStatus: 'Expired' })).toBe('Expired');
    expect(getClusterStateLabel({ ...ARC_OFFLINE, connectivityStatus: undefined })).toBe('Unknown');
  });

  test('prefers Failed over Offline — the provisioning state names the actual fault', () => {
    expect(getClusterStateLabel({ ...ARC_OFFLINE, provisioningState: 'Failed' })).toBe('Failed');
  });
});
