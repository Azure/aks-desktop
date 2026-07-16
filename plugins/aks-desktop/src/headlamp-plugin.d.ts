// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/// <reference types="@kinvolk/headlamp-plugin" />

// Local type augmentation for the `registerClusterProviderPreOpen` extension
// point added to Headlamp core (frontend `plugin/registry`). It is available on
// the runtime plugin lib, but the pinned `@kinvolk/headlamp-plugin` types do not
// declare it yet. Remove this block once the published types include it.
declare module '@kinvolk/headlamp-plugin/lib' {
  /** Context passed to a pre-open hook when a cluster is about to be opened. */
  export interface ClusterPreOpenContext {
    /** The name of the cluster being opened. */
    cluster: string;
    /** The cluster's configuration, if known. */
    clusterConf?: any;
    /** Reports progress text to the connecting popup shown while preparing. */
    reportProgress?: (message: string) => void;
  }

  /**
   * A hook run once, before a cluster's views are rendered. Resolve to allow the
   * cluster to open; reject to block it and surface the error to the user.
   */
  export type ClusterPreOpenHook = (context: ClusterPreOpenContext) => Promise<void>;

  /** Register a hook that runs before a cluster is opened. */
  export function registerClusterProviderPreOpen(hook: ClusterPreOpenHook): void;
}

export {};
