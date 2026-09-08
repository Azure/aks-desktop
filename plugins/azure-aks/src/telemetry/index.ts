// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

export interface ClusterShapeInput {
  kubernetesVersion: string | null | undefined;
  nodeCount: number | null | undefined;
  namespaceCount: number | null | undefined;
  region: string | null | undefined;
  aksTier: string | null | undefined;
}

/** Forwards cluster shape telemetry to the AKS Desktop telemetry owner. */
export function trackClusterShape(dedupeKey: string, input: ClusterShapeInput): void {
  window.dispatchEvent(
    new CustomEvent('aks-desktop:cluster-shape', {
      detail: { dedupeKey, input },
    })
  );
}
