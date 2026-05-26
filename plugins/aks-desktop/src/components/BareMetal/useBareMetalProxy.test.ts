// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, test } from 'vitest';
import { didBareMetalProxyDrop } from './useBareMetalProxy';

describe('didBareMetalProxyDrop', () => {
  test('returns true when a running proxy transitions to stopped', () => {
    expect(didBareMetalProxyDrop('running', 'stopped')).toBe(true);
  });

  test('returns true when a running proxy transitions to error', () => {
    expect(didBareMetalProxyDrop('running', 'error')).toBe(true);
  });

  test('returns false for non-running previous states', () => {
    expect(didBareMetalProxyDrop(null, 'stopped')).toBe(false);
    expect(didBareMetalProxyDrop('starting', 'error')).toBe(false);
  });
});
