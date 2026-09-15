// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockExecCommand = vi.hoisted(() => vi.fn());

vi.mock('../shared/runCommandAsync', () => ({
  runCommandAsync: mockExecCommand,
}));

vi.mock('../azure/az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI',
}));

vi.mock('../shared/quoteForPlatform', () => ({
  quoteForPlatform: (value: string) => value,
}));

import { resolveAzureADUser, searchAzureADUsers } from '../azure/az-ad';

describe('searchAzureADUsers', () => {
  beforeEach(() => {
    mockExecCommand.mockReset();
  });

  test('returns parsed users on success', async () => {
    const users = [
      {
        id: '11111111-2222-3333-4444-555555555555',
        displayName: 'Alice Smith',
        mail: 'alice@example.com',
        userPrincipalName: 'alice@example.com',
      },
      {
        id: '22222222-3333-4444-5555-666666666666',
        displayName: 'Alice Jones',
        mail: null,
        userPrincipalName: 'alicej@example.com',
      },
    ];
    mockExecCommand.mockResolvedValue({ stdout: JSON.stringify(users), stderr: '' });

    const result = await searchAzureADUsers('Alice');

    expect(result.success).toBe(true);
    expect(result.users).toHaveLength(2);
    expect(result.users[0].displayName).toBe('Alice Smith');
    expect(result.users[1].id).toBe('22222222-3333-4444-5555-666666666666');
  });

  test('returns empty array for empty query', async () => {
    const result = await searchAzureADUsers('');

    expect(result.success).toBe(true);
    expect(result.users).toEqual([]);
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  test('returns empty array for single-character query', async () => {
    const result = await searchAzureADUsers('a');

    expect(result.success).toBe(true);
    expect(result.users).toEqual([]);
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  test('returns empty array for query with OData-unsafe characters', async () => {
    const result = await searchAzureADUsers("O'Brien");

    expect(result.success).toBe(true);
    expect(result.users).toEqual([]);
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  test('returns empty array for query with parentheses', async () => {
    const result = await searchAzureADUsers('test()');

    expect(result.success).toBe(true);
    expect(result.users).toEqual([]);
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  test('returns empty result set', async () => {
    mockExecCommand.mockResolvedValue({ stdout: '[]', stderr: '' });

    const result = await searchAzureADUsers('nonexistent');

    expect(result.success).toBe(true);
    expect(result.users).toEqual([]);
  });

  test('returns error on relogin needed', async () => {
    mockExecCommand.mockResolvedValue({
      stdout: '',
      stderr: 'Interactive authentication is needed',
    });

    const result = await searchAzureADUsers('Alice');

    expect(result.success).toBe(false);
    expect(result.users).toEqual([]);
    expect(result.error).toContain('Authentication required');
  });

  test('returns error on conditional access policy (AADSTS530084)', async () => {
    mockExecCommand.mockResolvedValue({
      stdout: '',
      stderr: 'AADSTS530084: The resource requires application permissions.',
    });

    const result = await searchAzureADUsers('Alice');

    expect(result.success).toBe(false);
    expect(result.users).toEqual([]);
    expect(result.error).toContain('AADSTS530084');
  });

  test('returns error on Authorization_RequestDenied', async () => {
    mockExecCommand.mockResolvedValue({
      stdout: '',
      stderr: 'Authorization_RequestDenied: Insufficient privileges to complete the operation.',
    });

    const result = await searchAzureADUsers('Alice');

    expect(result.success).toBe(false);
    expect(result.users).toEqual([]);
    expect(result.error).toContain('Authorization_RequestDenied');
  });

  test('returns error on generic az CLI error', async () => {
    mockExecCommand.mockResolvedValue({
      stdout: '',
      stderr: 'ERROR: Something went wrong',
    });

    const result = await searchAzureADUsers('Alice');

    expect(result.success).toBe(false);
    expect(result.users).toEqual([]);
    expect(result.error).toBeDefined();
  });

  test('returns error on malformed JSON', async () => {
    mockExecCommand.mockResolvedValue({ stdout: 'not valid json', stderr: '' });

    const result = await searchAzureADUsers('Alice');

    expect(result.success).toBe(false);
    expect(result.users).toEqual([]);
    expect(result.error).toBeDefined();
  });

  test('passes correct OData filter to az command', async () => {
    mockExecCommand.mockResolvedValue({ stdout: '[]', stderr: '' });

    await searchAzureADUsers('alice');

    expect(mockExecCommand).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining([
        '--filter',
        expect.stringContaining("startswith(displayName,'alice')"),
      ])
    );
  });
});

describe('resolveAzureADUser', () => {
  beforeEach(() => {
    mockExecCommand.mockReset();
  });

  test('returns Conditional Access errors to the caller', async () => {
    mockExecCommand.mockResolvedValue({
      stdout: '',
      stderr: 'AADSTS530084: Access has been blocked by conditional access token protection.',
    });

    const result = await resolveAzureADUser('alice@contoso.com');

    expect(result.success).toBe(false);
    expect(result.error).toContain('AADSTS530084');
  });
});
