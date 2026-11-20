// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Whether the local cluster's API server answers `/readyz` through Headlamp's cluster proxy, for
// the Overview Status field. It routes by the name AKS Desktop lists the cluster under, which its
// backend keys the cluster by, never logs the user out on an authentication error and gives up
// after PROBE_TIMEOUT_MS.

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

export const PROBE_TIMEOUT_MS = 10000;

/** True when `/readyz` returns a 2xx status; false on any other status, error or timeout. */
export async function apiServerReady(listName: string): Promise<boolean> {
  try {
    await ApiProxy.clusterRequest('/readyz', {
      cluster: listName,
      isJSON: false,
      autoLogoutOnAuthError: false,
      timeout: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}
