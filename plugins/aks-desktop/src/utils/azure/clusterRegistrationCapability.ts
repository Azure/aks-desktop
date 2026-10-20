// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Result returned by Headlamp's injected native registration capability. */
export interface ClusterRegistrationCapabilityResult {
  /** Whether native registration updated the destination kubeconfig. */
  success: boolean;
  /** User-facing success or failure detail. */
  message: string;
}

/**
 * Native registration function available only to an attested provider plugin.
 *
 * @param provider - Stable native provider ID.
 * @param options - Provider-defined options validated by the native provider.
 * @returns Native registration result.
 */
export type RegisterClusterCapability = (
  provider: string,
  options: unknown
) => Promise<ClusterRegistrationCapabilityResult>;

declare const registerCluster: RegisterClusterCapability | undefined;

/**
 * Reads the private lexical capability injected by Headlamp's trusted plugin loader.
 *
 * @returns Registration capability, or undefined outside an authorized desktop plugin.
 */
export function getClusterRegistrationCapability(): RegisterClusterCapability | undefined {
  return typeof registerCluster === 'function' ? registerCluster : undefined;
}
