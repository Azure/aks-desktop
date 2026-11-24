// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The platform check. The plugin asks the browser whether this is 64-bit Windows on x64; AKS
// Desktop provides no capability to ask. Only Setup's environment step runs it, with its other
// checks. Only a definite "no" fails, with `unsupported`; an answer the browser cannot give shows
// as not verified and blocks nothing.

import { detectWindowsX64 } from '../native/platformChecks';
import { hostError } from './failure';
import { update } from './store';

/**
 * Asks the browser whether this is Windows x64 and records the answer as `windowsX64`. Rejects with
 * host `unsupported` only for a definite "no".
 */
export async function checkPlatform(): Promise<void> {
  const windowsX64 = await detectWindowsX64();
  update({ windowsX64 });
  if (windowsX64 === false) throw hostError('unsupported');
}
