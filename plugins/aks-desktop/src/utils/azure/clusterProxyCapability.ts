// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Result returned by the injected desktop proxy capability. */
export interface ClusterProxyCapabilityResult {
  success: boolean;
  error?: string;
}

/** Private capability injected by Headlamp while executing AKS Desktop. */
export type StartClusterProxyCapability = (target: {
  cluster: string;
  subscriptionId: string;
  resourceGroup: string;
}) => Promise<ClusterProxyCapabilityResult>;

declare const startClusterProxy: StartClusterProxyCapability | undefined;

/** Returns the private proxy capability injected by Headlamp's plugin loader. */
export function getStartClusterProxyCapability(): StartClusterProxyCapability | undefined {
  return typeof startClusterProxy === 'function' ? startClusterProxy : undefined;
}
