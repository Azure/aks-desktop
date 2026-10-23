// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/// <reference types="@kinvolk/headlamp-plugin" />

import type { AppTheme } from '@kinvolk/headlamp-plugin/lib/AppTheme';

// Remove these augmentations when the published SDK includes the host APIs.
declare module '@kinvolk/headlamp-plugin/lib/AppTheme' {
  interface AppTheme {
    secondaryContrastText?: string;
  }
}

declare module '@kinvolk/headlamp-plugin/lib' {
  export function registerAppTheme(theme: AppTheme, options?: { default?: boolean }): void;

  export function registerClusterEmptyState(
    component: (props: { defaultContent: React.ReactNode }) => React.ReactNode
  ): void;
}
