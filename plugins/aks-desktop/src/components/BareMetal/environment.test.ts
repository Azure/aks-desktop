// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/azure/az-cli-core', () => ({
  debugLog: vi.fn(),
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unknown error'),
  isAzError: (stderr: string) => stderr.includes('ERROR:'),
  runCommandAsync: vi.fn(),
}));

import { runCommandAsync } from '../../utils/azure/az-cli-core';
import { setupBareMetalEnvironment, teardownBareMetalEnvironment } from './environment';

const mockRun = vi.mocked(runCommandAsync);

describe('setupBareMetalEnvironment', () => {
  it('should succeed when all steps complete', async () => {
    mockRun.mockResolvedValue({ stdout: '{}', stderr: '' });

    const result = await setupBareMetalEnvironment({
      subscription: 'sub-1',
      location: 'eastus',
      username: 'admin',
      password: 'secret',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('created successfully');
  });

  it('should return error when provider registration fails', async () => {
    mockRun.mockResolvedValueOnce({
      stdout: '',
      stderr: 'ERROR: Provider registration failed',
    });

    const result = await setupBareMetalEnvironment({
      subscription: 'sub-1',
      location: 'eastus',
      username: 'admin',
      password: 'secret',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to register provider');
  });

  it('should return error when VM creation fails', async () => {
    // Providers + resource group succeed
    mockRun.mockResolvedValue({ stdout: '{}', stderr: '' });
    // Then override for the VM creation call (last call)
    mockRun.mockImplementation(async (_cmd, args) => {
      if (args.includes('vm')) {
        return { stdout: '', stderr: 'ERROR: VM quota exceeded' };
      }
      return { stdout: '{}', stderr: '' };
    });

    const result = await setupBareMetalEnvironment({
      subscription: 'sub-1',
      location: 'eastus',
      username: 'admin',
      password: 'secret',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to create VM');
  });
});

describe('teardownBareMetalEnvironment', () => {
  it('should succeed when resource group deletion initiates', async () => {
    mockRun.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await teardownBareMetalEnvironment('sub-1', 'my-rg');

    expect(result.success).toBe(true);
    expect(result.message).toContain('deletion initiated');
  });

  it('should use default group name', async () => {
    mockRun.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await teardownBareMetalEnvironment('sub-1');

    expect(result.success).toBe(true);
    expect(result.message).toContain('jumpstart-rg');
  });

  it('should return error on failure', async () => {
    mockRun.mockResolvedValue({
      stdout: '',
      stderr: 'ERROR: Resource group not found',
    });

    const result = await teardownBareMetalEnvironment('sub-1', 'bad-rg');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to delete resource group');
  });
});
