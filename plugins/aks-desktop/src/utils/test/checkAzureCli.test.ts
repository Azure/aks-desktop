// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { checkAzureCli } from '../azure/checkAzureCli';

const runCommandAsync = vi.hoisted(() => vi.fn());

vi.mock('../azure/az-cli-core', () => ({ runCommandAsync }));

const versionJson = (version: string, extensions: Record<string, string> = {}) => ({
  stdout: JSON.stringify({ 'azure-cli': version, extensions }),
  stderr: '',
});

describe('checkAzureCli', () => {
  beforeEach(() => {
    runCommandAsync.mockReset();
  });

  test('never suggests installing the aks-preview extension', async () => {
    runCommandAsync.mockResolvedValue(versionJson('2.89.0'));

    const result = await checkAzureCli();

    expect(result.suggestions.join(' ')).not.toContain('aks-preview');
  });

  test('accepts 2.85.0 as meeting the managed-namespace floor', async () => {
    runCommandAsync.mockResolvedValue(versionJson('2.85.0'));

    const result = await checkAzureCli();

    expect(result.cliVersionOk).toBe(true);
    expect(result.suggestions).toEqual([]);
  });

  test('rejects 2.84.0 as below the managed-namespace floor', async () => {
    runCommandAsync.mockResolvedValue(versionJson('2.84.0'));

    const result = await checkAzureCli();

    expect(result.cliVersionOk).toBe(false);
    expect(result.suggestions.join(' ')).toContain('2.85');
  });
});
