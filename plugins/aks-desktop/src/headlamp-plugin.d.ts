// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/// <reference types="@kinvolk/headlamp-plugin" />

import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';

// Runtime export added in Headlamp PR 6886. Remove this declaration once the
// published plugin SDK includes WorkloadLogs.
declare module '@kinvolk/headlamp-plugin/lib/CommonComponents' {
  export function WorkloadLogs(props: { item: KubeObject }): React.ReactNode;
}

// Local type augmentation for the `registerClusterProviderPreOpen` extension
// point added to Headlamp core (frontend `plugin/registry`). It is available on
// the runtime plugin lib, but the pinned `@kinvolk/headlamp-plugin` types do not
// declare it yet. Remove this block once the published types include it.
declare module '@kinvolk/headlamp-plugin/lib' {
  /** Context passed to a pre-open hook when a cluster is about to be opened. */
  export interface ClusterPreOpenContext {
    /** The name of the cluster being opened. */
    readonly cluster: string;
    /** The cluster's configuration, if known. */
    readonly clusterConf: unknown;
    /** Aborts when cluster preparation is no longer needed. */
    readonly signal?: AbortSignal;
    /** Reports progress text to the connecting popup shown while preparing. */
    readonly reportProgress?: (message: string) => void;
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
