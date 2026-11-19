// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { PipelineConfig } from '../types';

/**
 * Derives the configured login prefix, falling back to the ARM name for non-deployment operations.
 */
export function deriveAcrName(config: PipelineConfig): string {
  if (config.acrLoginServer) {
    const name = config.acrLoginServer.split('.')[0];
    if (name) return name;
    throw new Error(
      `Could not derive ACR name from login server: "${config.acrLoginServer}". Expected format: <name>.azurecr.io`
    );
  }
  if (config.acrResourceId) {
    const segments = config.acrResourceId.split('/');
    const idx = segments.findIndex(s => s.toLowerCase() === 'registries');
    if (idx !== -1 && idx + 1 < segments.length && segments[idx + 1]) {
      return segments[idx + 1];
    }
    throw new Error(
      `Could not derive ACR name from resource ID: "${config.acrResourceId}". Expected "/registries/<name>" segment.`
    );
  }
  throw new Error(
    'Cannot derive ACR name: neither acrLoginServer nor acrResourceId is set on PipelineConfig'
  );
}

/** Requires the actual host before generating image references; ARM names cannot identify DNL hosts. */
export function requireAcrLoginServer(config: PipelineConfig): string {
  if (config.acrLoginServer?.trim()) return config.acrLoginServer.trim();
  throw new Error(
    'The actual ACR login server is required for deployment; reselect the registry to resolve it. An ARM resource ID alone cannot identify its login host.'
  );
}
