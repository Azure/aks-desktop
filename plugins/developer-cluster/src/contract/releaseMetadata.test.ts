// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import artifactHubText from '../../0.1.0-alpha/artifacthub-pkg.yml?raw';
import packageText from '../../package.json?raw';
import { PRODUCT_DISPLAY_NAME } from './routes';

describe('release metadata', () => {
  const manifest = JSON.parse(packageText);

  it('keeps the package name AKS Desktop grants commands to', () => {
    // A rename also needs an AKS Desktop policy change.
    expect(manifest.name).toBe('@headlamp-k8s/developer-cluster');
    // headlamp-plugin package only warns when an extraDist file is missing.
    expect(manifest.headlamp.extraDist).toEqual({ LICENSE: 'LICENSE' });
  });

  it('keeps the Artifact Hub metadata on the package version and product name', () => {
    // The version is also the folder of the Artifact Hub metadata.
    expect(manifest.version).toBe('0.1.0-alpha');
    const lines = artifactHubText.split(/\r?\n/);
    expect(lines).toContain(`version: ${manifest.version}`);
    expect(lines).toContain(`displayName: ${PRODUCT_DISPLAY_NAME}`);
  });
});
