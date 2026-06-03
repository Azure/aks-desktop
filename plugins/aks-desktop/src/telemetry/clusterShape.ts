// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { bucketNamespaceCount, bucketNodeCount, kubernetesMinor, sanitizeRegion } from './schema';
import { trackClusterShape } from './track';

const VALID_TIERS = new Set(['Free', 'Standard', 'Premium']);

function sanitizeTier(tier: string | undefined): 'Free' | 'Standard' | 'Premium' | 'Unknown' {
  return tier && VALID_TIERS.has(tier) ? (tier as 'Free' | 'Standard' | 'Premium') : 'Unknown';
}

export interface ClusterShapeInput {
  kubernetesVersion: string | undefined;
  nodeCount: number | undefined;
  namespaceCount: number | undefined;
  region: string | undefined;
  aksTier: string | undefined;
}

/**
 * Fire `headlamp.cluster-shape` only when every field is available. We
 * never ship half-populated envelopes — it's better to lose the signal
 * than mix dimensions that mean "unknown" with dimensions that mean
 * "real value".
 */
export function emitClusterShapeIfReady(input: ClusterShapeInput): boolean {
  if (
    input.kubernetesVersion === undefined ||
    input.nodeCount === undefined ||
    input.namespaceCount === undefined ||
    input.region === undefined ||
    input.aksTier === undefined
  ) {
    return false;
  }

  trackClusterShape({
    provider: 'AKS',
    kubernetesMinor: kubernetesMinor(input.kubernetesVersion),
    nodeCountBucket: bucketNodeCount(input.nodeCount),
    namespaceCountBucket: bucketNamespaceCount(input.namespaceCount),
    region: sanitizeRegion(input.region),
    aksTier: sanitizeTier(input.aksTier),
  });
  return true;
}
