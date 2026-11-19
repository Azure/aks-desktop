// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/// <reference types="@kinvolk/headlamp-plugin" />

export {};

// Runtime export added by AKS Desktop patch 8519 (`frontend/src/plugin/registry.tsx`). The
// published plugin SDK does not declare it; remove this block once it does.
declare module '@kinvolk/headlamp-plugin/lib' {
  /** A plugin's claim on the cluster menu's Delete for the clusters it manages. */
  export interface ClusterDeleteHandler {
    /** Whether the plugin handles Delete for this cluster entry. */
    owns: (cluster: any) => boolean;
    /** The `openConfirmDialog` value that opens the plugin's delete dialog. */
    dialog: string;
  }
  export function registerClusterProviderDeleteHandler(handler: ClusterDeleteHandler): void;
}
