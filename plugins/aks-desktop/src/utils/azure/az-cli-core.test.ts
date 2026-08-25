// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execCommand: vi.fn(),
  getAzCommand: vi.fn(() => '/bundled/az'),
}));

vi.mock('../shared/runCommandAsync', () => ({
  runCommandAsync: mocks.execCommand,
}));

vi.mock('./az-cli-path', () => ({
  getAzCommand: mocks.getAzCommand,
}));

import {
  getErrorMessage,
  isAzCliInstalled,
  isAzCliLoggedIn,
  isAzError,
  isCliNotFoundError,
  isValidGuid,
  needsRelogin,
  runAzCommand,
  runCommandAsync,
} from './az-cli-core';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('needsRelogin', () => {
  test.each([
    'Interactive authentication is needed. Please run: az login',
    'AADSTS700082: The refresh token has expired.',
    'AADSTS50173: The provided grant has expired.',
    'Please run "az login" to setup account.',
    'ERROR: Please run az login',
  ])('recognizes Azure CLI login guidance: %s', error => {
    expect(needsRelogin(error)).toBe(true);
  });

  test('does not classify unrelated command failures as relogin guidance', () => {
    expect(needsRelogin('Command execution error: bridge disconnected')).toBe(false);
  });
});

describe('command helpers', () => {
  test('resolves Azure CLI commands through the bundled path', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: 'ok', stderr: '' });

    await expect(runCommandAsync('az', ['version'])).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
    });
    expect(mocks.execCommand).toHaveBeenCalledWith('/bundled/az', ['version']);
  });

  test('passes non-Azure commands through unchanged', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: 'ok', stderr: '' });

    await runCommandAsync('kubectl', ['version']);

    expect(mocks.execCommand).toHaveBeenCalledWith('kubectl', ['version']);
  });

  test('validates GUIDs', () => {
    expect(isValidGuid('12345678-1234-1234-1234-123456789abc')).toBe(true);
    expect(isValidGuid('not-a-guid')).toBe(false);
  });

  test('classifies Azure and missing-command errors', () => {
    expect(isAzError('ERROR: command failed')).toBe(true);
    expect(isAzError('WARNING: retrying')).toBe(false);
    expect(isCliNotFoundError('az: command not found')).toBe(true);
    expect(isCliNotFoundError('Azure CLI (az) command not found')).toBe(true);
    expect(isCliNotFoundError('bridge disconnected')).toBe(false);
  });

  test('normalizes thrown error messages', () => {
    expect(getErrorMessage(new Error('failed'))).toBe('failed');
    expect(getErrorMessage('private value')).toBe('Unknown error');
  });
});

describe('Azure CLI status', () => {
  test.each([
    [{ stdout: '{"azure-cli":"2.78.0"}', stderr: '' }, true],
    [{ stdout: '{"extensions":[]}', stderr: '' }, false],
    [{ stdout: '{invalid', stderr: '' }, false],
    [{ stdout: '', stderr: '' }, false],
    [{ stdout: '', stderr: 'az: command not found' }, false],
  ])('reports installation status for %o', async (result, expected) => {
    mocks.execCommand.mockResolvedValue(result);

    await expect(isAzCliInstalled()).resolves.toBe(expected);
  });

  test('reports Azure CLI as unavailable when the bridge rejects', async () => {
    mocks.execCommand.mockRejectedValue(new Error('bridge failed'));

    await expect(isAzCliInstalled()).resolves.toBe(false);
  });

  test('reports a usable logged-in account', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: 'user@example.com\n', stderr: '' });

    await expect(isAzCliLoggedIn()).resolves.toBe(true);
  });

  test.each([
    'az: command not found',
    'Please run "az login" to setup account.',
    'No active account',
  ])('reports logged out for stderr: %s', async stderr => {
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr });

    await expect(isAzCliLoggedIn()).resolves.toBe(false);
  });

  test('reports logged out when the bridge rejects', async () => {
    mocks.execCommand.mockRejectedValue(new Error('bridge failed'));

    await expect(isAzCliLoggedIn()).resolves.toBe(false);
  });
});

describe('runAzCommand', () => {
  test('returns parsed command output', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '{"value":42}', stderr: '' });

    await expect(
      runAzCommand(['mock'], 'Running:', 'run mock', stdout => JSON.parse(stdout).value)
    ).resolves.toEqual({ success: true, data: 42 });
  });

  test('returns success without a parser', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr: 'WARNING: harmless' });

    await expect(runAzCommand(['mock'], 'Running:', 'run mock')).resolves.toEqual({
      success: true,
      data: undefined,
    });
  });

  test('returns an authentication error for relogin guidance', async () => {
    mocks.execCommand.mockResolvedValue({
      stdout: '',
      stderr: 'Please run "az login" to setup account.',
    });

    await expect(runAzCommand(['mock'], 'Running:', 'run mock')).resolves.toEqual({
      success: false,
      error: 'Authentication required. Please log in to Azure CLI: az login',
    });
  });

  test('allows a stderr callback to return a domain result', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr: 'WARNING: partial result' });

    await expect(
      runAzCommand(['mock'], 'Running:', 'run mock', undefined, () => ({
        success: true,
        warning: true,
      }))
    ).resolves.toEqual({ success: true, warning: true });
  });

  test('falls through when a stderr callback declines the result', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr: 'ERROR: failed' });

    await expect(
      runAzCommand(['mock'], 'Running:', 'run mock', undefined, () => null)
    ).resolves.toEqual({
      success: false,
      error: 'Failed to run mock: ERROR: failed',
    });
  });

  test('reports parser and command exceptions', async () => {
    mocks.execCommand
      .mockResolvedValueOnce({ stdout: '{invalid', stderr: '' })
      .mockRejectedValueOnce('private failure');

    await expect(
      runAzCommand(['mock'], 'Running:', 'parse output', stdout => JSON.parse(stdout))
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Failed to parse output'),
    });
    await expect(runAzCommand(['mock'], 'Running:', 'run mock')).resolves.toEqual({
      success: false,
      error: 'Failed to run mock: Unknown error',
    });
  });
});
