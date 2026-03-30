// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { deriveBuildContext } from './useDockerfileDiscovery';

describe('deriveBuildContext', () => {
  it('should return . for root Dockerfile', () => {
    expect(deriveBuildContext('Dockerfile')).toBe('.');
  });

  it('should return parent directory for nested Dockerfile', () => {
    expect(deriveBuildContext('src/web/Dockerfile')).toBe('./src/web');
  });

  it('should handle single-level nesting', () => {
    expect(deriveBuildContext('app/Dockerfile')).toBe('./app');
  });
});
