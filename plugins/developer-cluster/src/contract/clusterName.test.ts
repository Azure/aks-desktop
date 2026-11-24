// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import {
  CLUSTER_NAME_MAX_LENGTH,
  clusterNameProblem,
  DEFAULT_CLUSTER_NAME,
  isClusterName,
} from './clusterName';

describe('cluster name', () => {
  it('defaults to a valid name', () => {
    expect(DEFAULT_CLUSTER_NAME).toBe('dev-cluster');
    expect(isClusterName(DEFAULT_CLUSTER_NAME)).toBe(true);
    expect(CLUSTER_NAME_MAX_LENGTH).toBe(63);
  });

  it.each([
    'a',
    '0',
    '1a',
    'a1',
    'a-b',
    'a--b',
    'aks-local',
    'a'.repeat(63),
    `a${'-'.repeat(61)}b`,
  ])('accepts %j', name => {
    expect(clusterNameProblem(name)).toBeNull();
    expect(isClusterName(name)).toBe(true);
  });

  it.each<[string, string]>([
    ['', 'required'],
    ['a'.repeat(64), 'too-long'],
    ['A'.repeat(64), 'too-long'],
    ['AKS', 'characters'],
    ['aks-Local', 'characters'],
    ['a_b', 'characters'],
    ['a.b', 'characters'],
    ['a b', 'characters'],
    [' a', 'characters'],
    ['a\n', 'characters'],
    ['\u00e4', 'characters'],
    ['-', 'boundary'],
    ['--', 'boundary'],
    ['-a', 'boundary'],
    ['a-', 'boundary'],
    ['--purge', 'boundary'],
  ])('rejects %j as %s', (name, problem) => {
    expect(clusterNameProblem(name)).toBe(problem);
    expect(isClusterName(name)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 1, ['a'], { name: 'a' }]) {
      expect(isClusterName(value)).toBe(false);
    }
  });
});
