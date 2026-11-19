// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Whether the local cluster's API server answers `/readyz` through Headlamp's cluster proxy, for
// the Overview Status field. It uses the cluster's kubeconfig context that Headlamp loaded, never
// logs the user out on an authentication error and gives up after PROBE_TIMEOUT_MS.

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

export const PROBE_TIMEOUT_MS = 10000;

/** True when `/readyz` returns a 2xx status; false on any other status, error or timeout. */
export async function apiServerReady(contextName: string): Promise<boolean> {
  try {
    await ApiProxy.clusterRequest('/readyz', {
      cluster: contextName,
      isJSON: false,
      autoLogoutOnAuthError: false,
      timeout: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}
