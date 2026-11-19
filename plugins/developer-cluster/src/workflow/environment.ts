// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The environment checks of Setup. Pure functions over an inspected environment: the consent kind
// and everything that blocks Next.

import { ConsentKind, HostEnvironment } from '../contract/capability';

export type EnvironmentBlocker = 'wsl-manual-setup' | 'wsl-unknown' | 'target-registered';

/** `install` when WSL 2 is ready, otherwise null. */
export function consentKind(environment: HostEnvironment): ConsentKind | null {
  return environment.wsl === 'ready' ? 'install' : null;
}

/**
 * Everything that blocks Next, in display order; empty when Next is allowed. A target means the
 * kubeconfig already has a local cluster's context.
 */
export function environmentBlockers(environment: HostEnvironment): readonly EnvironmentBlocker[] {
  const blockers: EnvironmentBlocker[] = [];
  if (environment.wsl === 'manual-setup-required') blockers.push('wsl-manual-setup');
  if (environment.wsl === 'unknown') blockers.push('wsl-unknown');
  if (environment.target !== null) blockers.push('target-registered');
  return Object.freeze(blockers);
}
