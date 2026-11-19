// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import {
  isValidAzResourceGroupName,
  isValidAzResourceName,
  isValidGitBranchName,
} from './az-validation';

describe('isValidAzResourceGroupName', () => {
  it.each([
    'a',
    'a'.repeat(90),
    'team.prod',
    'rg(test)',
    '_rg',
    '-rg',
    'équipe_资源١-９',
    'กลุ่ม',
    'cafe\u0301',
    'rg‿name',
  ])('accepts Azure resource group name %s', name => {
    expect(isValidAzResourceGroupName(name)).toBe(true);
  });

  it.each([
    '',
    'a'.repeat(91),
    'rg.',
    '.',
    'rg/name',
    'rg\\name',
    'rg name',
    'rg\n',
    'rg\r',
    'rg\t',
    'rg\u0000',
    "rg'name",
    'rg;name',
    'rg💡',
    'rg²',
  ])('rejects invalid resource group name %j', name => {
    expect(isValidAzResourceGroupName(name)).toBe(false);
  });

  it.each(['team.prod', 'rg(test)', 'équipe', '-identity'])(
    'does not broaden identity/resource name validation for %s',
    name => {
      expect(isValidAzResourceName(name)).toBe(false);
    }
  );
});

describe('isValidGitBranchName', () => {
  it.each(['main', 'release/deploy', 'feature/v1.0_test', 'team/sub/branch-1'])(
    'accepts Git branch name %s',
    branch => {
      expect(isValidGitBranchName(branch)).toBe(true);
    }
  );

  it.each([
    '',
    '/main',
    'main/',
    'release//deploy',
    '.hidden',
    'release/.hidden',
    'release..deploy',
    '../evil',
    'main.',
    'main.lock',
    'release/topic.lock',
    'bad branch',
    'a'.repeat(256),
  ])('rejects invalid Git branch name %j', branch => {
    expect(isValidGitBranchName(branch)).toBe(false);
  });
});
