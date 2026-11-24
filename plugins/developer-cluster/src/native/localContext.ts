// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Reads the Developer Cluster target from the kubeconfig contexts Headlamp loaded. `cluster create`
// writes the context, with the CLI's `context_info`, into the user's default kubeconfig, and
// Headlamp reloads that file when it changes. The plugin reads Headlamp's `/config`, as Headlamp's
// own layout does, never the file.

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { decodeLocalTargets, LocalContextError, LocalTarget } from '../contract/capability';
import { NativeError } from '../workflow/failure';

export const CONFIG_TIMEOUT_MS = 10000;

/**
 * The one Developer Cluster target, or null when no loaded context is Developer Cluster's. A failed request is
 * native `failed`, a malformed response or context `invalid-metadata`, and more than one local
 * context host `collision`.
 *
 * @returns A promise of a frozen copy of the target, or null. It rejects with a NativeError for the
 * failures above.
 */
export async function readLocalTarget(): Promise<LocalTarget | null> {
  let config: unknown;
  try {
    config = await ApiProxy.request('/config', { timeout: CONFIG_TIMEOUT_MS }, false, false);
  } catch {
    throw new NativeError({ source: 'native', code: 'failed' });
  }
  let targets: LocalTarget[];
  try {
    targets = decodeLocalTargets(config);
  } catch (error) {
    if (error instanceof LocalContextError) {
      throw new NativeError({ source: 'native', code: 'invalid-metadata' });
    }
    throw error;
  }
  if (targets.length > 1) throw new NativeError({ source: 'host', code: 'collision' });
  return targets.length === 0 ? null : Object.freeze({ ...targets[0] });
}
