// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Tests for getClusterCapabilities and enableClusterAddon functions
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

interface MockChildProcess {
  stdout: {
    on: ReturnType<typeof vi.fn>;
  };
  stderr: {
    on: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
}

// Set up the global pluginRunCommand mock before any imports of az-cli
const mockPluginRunCommand = vi.hoisted(() => vi.fn());

// Make pluginRunCommand available as a global (az-cli.ts uses `declare const pluginRunCommand`)
vi.stubGlobal('pluginRunCommand', mockPluginRunCommand);

// Mock the headlamp plugin module (used for the type import)
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  runCommand: mockPluginRunCommand,
}));

vi.mock('../azure/az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI',
}));

// Import the actual functions under test
import { enableClusterAddon, getClusterCapabilities, getClusterCount } from '../azure/az-cli';

// Test helper function
const createMockChildProcess = (stdoutData: string, stderrData: string = ''): MockChildProcess => ({
  stdout: {
    on: vi.fn((event: string, callback: (data: string) => void) => {
      if (event === 'data' && stdoutData) {
        callback(stdoutData);
      }
    }),
  },
  stderr: {
    on: vi.fn((event: string, callback: (data: string) => void) => {
      if (event === 'data' && stderrData) {
        callback(stderrData);
      }
    }),
  },
  on: vi.fn((event: string, callback: () => void) => {
    if (event === 'exit') {
      callback();
    }
  }),
});

const defaultOptions = {
  subscriptionId: 'test-sub-123',
  resourceGroup: 'test-rg',
  clusterName: 'test-cluster',
};

describe('getClusterCapabilities', () => {
  beforeEach(() => {
    mockPluginRunCommand.mockClear();
  });

  test('parses all capability fields correctly from a full az aks show JSON output', async () => {
    const fullResponse = JSON.stringify({
      sku: 'Automatic',
      aadProfile: { enableAzureRbac: true },
      azureRbacEnabled: true,
      networkPolicy: 'cilium',
      networkPlugin: 'azure',
      prometheusEnabled: true,
      containerInsightsEnabled: true,
      kedaEnabled: true,
      vpaEnabled: true,
    });

    const mockProcess = createMockChildProcess(fullResponse);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCapabilities(defaultOptions);

    expect(result).toEqual({
      sku: 'Automatic',
      aadEnabled: true,
      azureRbacEnabled: true,
      networkPolicy: 'cilium',
      networkPlugin: 'azure',
      prometheusEnabled: true,
      containerInsightsEnabled: true,
      kedaEnabled: true,
      vpaEnabled: true,
    });
  });

  test('returns "none" for missing/null networkPolicy', async () => {
    const response = JSON.stringify({
      sku: 'Base',
      networkPolicy: null,
      networkPlugin: 'azure',
      prometheusEnabled: false,
      containerInsightsEnabled: false,
      kedaEnabled: false,
      vpaEnabled: false,
    });

    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCapabilities(defaultOptions);

    expect(result.networkPolicy).toBe('none');
  });

  test('returns "none" for empty string networkPolicy', async () => {
    const response = JSON.stringify({
      sku: 'Base',
      networkPolicy: '',
      networkPlugin: 'azure',
      prometheusEnabled: false,
      containerInsightsEnabled: false,
      kedaEnabled: false,
      vpaEnabled: false,
    });

    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCapabilities(defaultOptions);

    expect(result.networkPolicy).toBe('none');
  });

  test('returns null for missing boolean fields (prometheusEnabled, etc.)', async () => {
    const response = JSON.stringify({
      sku: 'Base',
      networkPolicy: null,
      networkPlugin: null,
    });

    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCapabilities(defaultOptions);

    expect(result.prometheusEnabled).toBeNull();
    expect(result.containerInsightsEnabled).toBeNull();
    expect(result.kedaEnabled).toBeNull();
    expect(result.vpaEnabled).toBeNull();
  });

  test('returns null for sku when missing', async () => {
    const response = JSON.stringify({
      networkPolicy: 'cilium',
      networkPlugin: 'azure',
    });

    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCapabilities(defaultOptions);

    expect(result.sku).toBeNull();
  });

  test('handles auth errors (stderr contains relogin message) by throwing error', async () => {
    const mockProcess = createMockChildProcess(
      '',
      'Interactive authentication is needed. Please run: az login'
    );
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await expect(getClusterCapabilities(defaultOptions)).rejects.toThrow(
      'Authentication required. Please log in to Azure CLI: az login'
    );
  });

  test('handles AADSTS700082 relogin error', async () => {
    const mockProcess = createMockChildProcess('', 'AADSTS700082: The refresh token has expired');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await expect(getClusterCapabilities(defaultOptions)).rejects.toThrow(
      'Authentication required. Please log in to Azure CLI: az login'
    );
  });

  test('handles command errors (stderr contains ERROR) by throwing error', async () => {
    const mockProcess = createMockChildProcess(
      '',
      'ERROR: (ResourceNotFound) The Resource was not found.'
    );
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await expect(getClusterCapabilities(defaultOptions)).rejects.toThrow(
      'Failed to get cluster capabilities'
    );
  });

  test('handles command errors (stderr contains ERROR: prefix) by throwing error', async () => {
    const mockProcess = createMockChildProcess('', 'ERROR: something went wrong');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await expect(getClusterCapabilities(defaultOptions)).rejects.toThrow(
      'Failed to get cluster capabilities'
    );
  });

  test('treats stderr with lowercase error (no ERROR: prefix) as success when valid stdout', async () => {
    const response = JSON.stringify({
      sku: 'Base',
      networkPolicy: 'calico',
      networkPlugin: 'azure',
      prometheusEnabled: true,
      containerInsightsEnabled: false,
      kedaEnabled: false,
      vpaEnabled: false,
    });

    const mockProcess = createMockChildProcess(
      response,
      'WARNING: The behavior of this command has been altered due to an error in the config'
    );
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCapabilities(defaultOptions);

    expect(result.sku).toBe('Base');
    expect(result.networkPolicy).toBe('calico');
    expect(result.prometheusEnabled).toBe(true);
  });

  test('handles JSON parse errors by throwing error', async () => {
    const mockProcess = createMockChildProcess('not valid json {{{');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await expect(getClusterCapabilities(defaultOptions)).rejects.toThrow(
      'Failed to parse cluster capabilities'
    );
  });

  test('handles empty stdout by throwing parse error', async () => {
    const mockProcess = createMockChildProcess('');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await expect(getClusterCapabilities(defaultOptions)).rejects.toThrow(
      'Failed to parse cluster capabilities'
    );
  });

  test('preserves false boolean values (does not coerce to null)', async () => {
    const response = JSON.stringify({
      sku: 'Base',
      networkPolicy: 'calico',
      networkPlugin: 'azure',
      prometheusEnabled: false,
      containerInsightsEnabled: false,
      kedaEnabled: false,
      vpaEnabled: false,
    });

    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCapabilities(defaultOptions);

    expect(result.prometheusEnabled).toBe(false);
    expect(result.containerInsightsEnabled).toBe(false);
    expect(result.kedaEnabled).toBe(false);
    expect(result.vpaEnabled).toBe(false);
  });

  test('passes correct arguments to az CLI', async () => {
    const response = JSON.stringify({
      sku: 'Base',
      networkPolicy: null,
      networkPlugin: 'azure',
      prometheusEnabled: false,
      containerInsightsEnabled: false,
      kedaEnabled: false,
      vpaEnabled: false,
    });

    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await getClusterCapabilities(defaultOptions);

    expect(mockPluginRunCommand).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining([
        'aks',
        'show',
        '--subscription',
        'test-sub-123',
        '--resource-group',
        'test-rg',
        '--name',
        'test-cluster',
        '--output',
        'json',
      ]),
      expect.anything()
    );
  });
});

describe('enableClusterAddon', () => {
  beforeEach(() => {
    mockPluginRunCommand.mockClear();
  });

  test('calls az aks update with --enable-azure-monitor-metrics for azure-monitor-metrics addon', async () => {
    const mockProcess = createMockChildProcess('');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await enableClusterAddon({ ...defaultOptions, addon: 'azure-monitor-metrics' });

    expect(mockPluginRunCommand).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining([
        'aks',
        'update',
        '--subscription',
        'test-sub-123',
        '--resource-group',
        'test-rg',
        '--name',
        'test-cluster',
        '--enable-azure-monitor-metrics',
        '--no-wait',
      ]),
      expect.anything()
    );
  });

  test('calls az aks update with --enable-keda for keda addon', async () => {
    const mockProcess = createMockChildProcess('');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await enableClusterAddon({ ...defaultOptions, addon: 'keda' });

    expect(mockPluginRunCommand).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining(['--enable-keda']),
      expect.anything()
    );
  });

  test('calls az aks update with --enable-vpa for vpa addon', async () => {
    const mockProcess = createMockChildProcess('');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    await enableClusterAddon({ ...defaultOptions, addon: 'vpa' });

    expect(mockPluginRunCommand).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining(['--enable-vpa']),
      expect.anything()
    );
  });

  test('returns { success: true } on successful execution', async () => {
    const mockProcess = createMockChildProcess('');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await enableClusterAddon({ ...defaultOptions, addon: 'keda' });

    expect(result).toEqual({ success: true });
  });

  test('returns error on auth failure (needsRelogin)', async () => {
    const mockProcess = createMockChildProcess(
      '',
      'Interactive authentication is needed. Please run: az login'
    );
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await enableClusterAddon({ ...defaultOptions, addon: 'keda' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication required');
  });

  test('returns error on AADSTS50173 auth failure', async () => {
    const mockProcess = createMockChildProcess('', 'AADSTS50173: Token expired');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await enableClusterAddon({ ...defaultOptions, addon: 'vpa' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication required');
  });

  test('returns error on command failure (stderr with ERROR)', async () => {
    const mockProcess = createMockChildProcess(
      '',
      'ERROR: (ResourceNotFound) The Resource was not found.'
    );
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await enableClusterAddon({
      ...defaultOptions,
      addon: 'azure-monitor-metrics',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to enable addons');
  });

  test('ignores warnings in stderr (WARNING: only)', async () => {
    const mockProcess = createMockChildProcess(
      '',
      'WARNING: The behavior of this command has been altered.'
    );
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await enableClusterAddon({ ...defaultOptions, addon: 'keda' });

    expect(result).toEqual({ success: true });
  });

  test('treats stderr with lowercase error (no ERROR: prefix) as success', async () => {
    const mockProcess = createMockChildProcess(
      '',
      'WARNING: The behavior of this command has been altered due to an error in the config'
    );
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await enableClusterAddon({ ...defaultOptions, addon: 'keda' });

    expect(result).toEqual({ success: true });
  });

  test('returns error when stderr has both WARNING: and ERROR:', async () => {
    const mockProcess = createMockChildProcess(
      '',
      'WARNING: something changed\nERROR: operation failed'
    );
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await enableClusterAddon({ ...defaultOptions, addon: 'keda' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('accepts an array of addons and produces a single CLI command with multiple --enable flags', async () => {
    const mockProcess = createMockChildProcess('');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await enableClusterAddon({
      ...defaultOptions,
      addon: ['azure-monitor-metrics', 'keda'],
    });

    expect(result).toEqual({ success: true });
    expect(mockPluginRunCommand).toHaveBeenCalledTimes(1);
    expect(mockPluginRunCommand).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining([
        'aks',
        'update',
        '--enable-azure-monitor-metrics',
        '--enable-keda',
        '--no-wait',
      ]),
      expect.anything()
    );
  });

  test('returns error for empty addon array', async () => {
    const result = await enableClusterAddon({
      ...defaultOptions,
      addon: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No addons specified');
  });
});

describe('getClusterCount', () => {
  const validSubscriptionId = '12345678-1234-1234-1234-123456789abc';

  beforeEach(() => {
    mockPluginRunCommand.mockClear();
  });

  test('returns cluster count from Count field', async () => {
    const response = JSON.stringify({ data: [{ Count: 5 }] });
    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCount(validSubscriptionId);

    expect(result).toBe(5);
  });

  test('returns cluster count from count_ field', async () => {
    const response = JSON.stringify({ data: [{ count_: 3 }] });
    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCount(validSubscriptionId);

    expect(result).toBe(3);
  });

  test('returns -1 for invalid subscription ID format', async () => {
    const result = await getClusterCount('not-a-guid');

    expect(result).toBe(-1);
    expect(mockPluginRunCommand).not.toHaveBeenCalled();
  });

  test('returns -1 for empty subscription ID', async () => {
    const result = await getClusterCount('');

    expect(result).toBe(-1);
    expect(mockPluginRunCommand).not.toHaveBeenCalled();
  });

  test('returns -1 when Azure CLI returns ERROR:', async () => {
    const mockProcess = createMockChildProcess('', 'ERROR: Resource graph query failed');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCount(validSubscriptionId);

    expect(result).toBe(-1);
  });

  test('returns -1 when response has no data', async () => {
    const response = JSON.stringify({ data: [] });
    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCount(validSubscriptionId);

    expect(result).toBe(-1);
  });

  test('returns -1 for malformed JSON response', async () => {
    const mockProcess = createMockChildProcess('not valid json');
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCount(validSubscriptionId);

    expect(result).toBe(-1);
  });

  test('returns 0 when count is zero', async () => {
    const response = JSON.stringify({ data: [{ Count: 0 }] });
    const mockProcess = createMockChildProcess(response);
    mockPluginRunCommand.mockReturnValue(mockProcess);

    const result = await getClusterCount(validSubscriptionId);

    expect(result).toBe(0);
  });
});
