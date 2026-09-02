// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runAzCommand } from './az-cli-core';

/**
 * Registers the Microsoft.ContainerService resource provider on a subscription.
 * Registration is idempotent, so it is safe to call on every subscription change.
 */
export function registerContainerServiceProvider(
  subscriptionId?: string
): Promise<{ success: boolean; error?: string }> {
  const args = ['provider', 'register', '-n', 'Microsoft.ContainerService'];
  if (subscriptionId) {
    args.push('--subscription', subscriptionId);
  }

  return runAzCommand(
    args,
    'Registering Microsoft.ContainerService provider:',
    'register Microsoft.ContainerService provider'
  );
}
