// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockRunCommand = vi.hoisted(() => vi.fn());
const mockClusterRequest = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: {
    clusterRequest: mockClusterRequest,
  },
  runCommand: mockRunCommand,
}));

type Handler = (...args: any[]) => void;

function createCommandHandle(
  options: {
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    autoExit?: boolean;
    hasKill?: boolean;
  } = {}
) {
  const handlers = new Map<string, Handler>();
  const handle = {
    pid: 1234,
    kill: options.hasKill === false ? undefined : vi.fn(),
    stdout: {
      on: vi.fn((event: string, callback: Handler) => {
        if (event === 'data' && options.stdout) {
          callback(options.stdout);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: Handler) => {
        if (event === 'data' && options.stderr) {
          callback(options.stderr);
        }
      }),
    },
    on: vi.fn((event: string, callback: Handler) => {
      handlers.set(event, callback);
      if (event === 'exit' && options.autoExit) {
        callback(options.exitCode ?? 0);
      }
    }),
    emit(event: string, ...args: any[]) {
      handlers.get(event)?.(...args);
    },
  };

  return handle;
}

async function loadBareMetalProxyModule() {
  vi.resetModules();
  (globalThis as any).pluginRunCommand = mockRunCommand;
  return import('./proxy');
}

function setupReachabilitySuccess() {
  mockClusterRequest.mockResolvedValue({});
}

function setupReachabilityFailure(message = 'Unable to connect to the server') {
  mockClusterRequest.mockRejectedValue(new Error(message));
}

describe('BareMetal proxy lifecycle', () => {
  beforeEach(() => {
    mockRunCommand.mockReset();
    mockClusterRequest.mockReset();
    vi.useRealTimers();
  });

  test('reconciles status to running when Headlamp namespace API succeeds after reload', async () => {
    setupReachabilitySuccess();

    const { getBareMetalProxyStatus } = await loadBareMetalProxyModule();
    const result = await getBareMetalProxyStatus('sub-1', 'rg-1', 'edge-arc-cluster');

    expect(result).toEqual({ success: true, status: 'running' });
    expect(mockClusterRequest).toHaveBeenCalledWith(
      '/api/v1/namespaces',
      expect.objectContaining({ cluster: 'edge-arc-cluster' }),
      { limit: '1' }
    );
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  test('reconciles status to stopped with last error when Headlamp namespace API fails', async () => {
    setupReachabilityFailure();

    const { getBareMetalProxyStatus } = await loadBareMetalProxyModule();
    const result = await getBareMetalProxyStatus('sub-1', 'rg-1', 'edge-arc-cluster');

    expect(result).toEqual({
      success: true,
      status: 'stopped',
      lastError: 'Unable to connect to the server',
    });
  });

  test('starts connectedk8s proxy after reconciliation reports stopped', async () => {
    setupReachabilityFailure('connection refused');
    const proxyCommand = createCommandHandle();
    mockRunCommand.mockReturnValueOnce(proxyCommand);

    const { startBareMetalProxy } = await loadBareMetalProxyModule();
    const result = await startBareMetalProxy('sub-1', 'rg-1', 'edge-arc-cluster');

    expect(result).toEqual({ success: true, status: 'starting', pid: 1234 });
    expect(mockRunCommand).toHaveBeenLastCalledWith(
      'az',
      [
        'connectedk8s',
        'proxy',
        '--subscription',
        'sub-1',
        '--resource-group',
        'rg-1',
        '--name',
        'edge-arc-cluster',
      ],
      {}
    );
  });

  test('does not start a duplicate proxy when reconciliation reports running', async () => {
    setupReachabilitySuccess();

    const { startBareMetalProxy } = await loadBareMetalProxyModule();
    const result = await startBareMetalProxy('sub-1', 'rg-1', 'edge-arc-cluster');

    expect(result).toEqual({ success: true, status: 'running' });
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  test('stop kills an active proxy command and marks it stopped', async () => {
    setupReachabilityFailure('connection refused');
    const proxyCommand = createCommandHandle();
    mockRunCommand.mockReturnValueOnce(proxyCommand);

    const { startBareMetalProxy, stopBareMetalProxy } = await loadBareMetalProxyModule();
    await startBareMetalProxy('sub-1', 'rg-1', 'edge-arc-cluster');
    const result = await stopBareMetalProxy('sub-1', 'rg-1', 'edge-arc-cluster');

    expect(proxyCommand.kill).toHaveBeenCalled();
    expect(result.status).toBe('stopped');
  });

  test('restart stops active proxy and starts a new one', async () => {
    const firstProxy = createCommandHandle();
    const secondProxy = createCommandHandle();
    setupReachabilityFailure('connection refused');
    mockRunCommand.mockReturnValueOnce(firstProxy).mockReturnValueOnce(secondProxy);

    const { startBareMetalProxy, restartBareMetalProxy } = await loadBareMetalProxyModule();
    await startBareMetalProxy('sub-1', 'rg-1', 'edge-arc-cluster');
    const result = await restartBareMetalProxy('sub-1', 'rg-1', 'edge-arc-cluster');

    expect(firstProxy.kill).toHaveBeenCalled();
    expect(result).toEqual({ success: true, status: 'starting', pid: 1234 });
    expect(mockRunCommand).toHaveBeenCalledTimes(2);
  });
});

describe('bareMetalProxyKey', () => {
  test('builds composite key from subscription, resource group and cluster name', async () => {
    const { bareMetalProxyKey } = await loadBareMetalProxyModule();
    expect(bareMetalProxyKey('sub-1', 'rg-1', 'cluster-1')).toBe('sub-1/rg-1/cluster-1');
  });
});

describe('checkClusterReachable', () => {
  beforeEach(() => {
    mockClusterRequest.mockReset();
  });

  test('returns success when namespace API succeeds', async () => {
    setupReachabilitySuccess();
    const { checkClusterReachable } = await loadBareMetalProxyModule();
    const result = await checkClusterReachable('my-cluster');
    expect(result).toEqual({ success: true });
  });

  test('returns failure with error message when namespace API fails', async () => {
    setupReachabilityFailure('connection refused');
    const { checkClusterReachable } = await loadBareMetalProxyModule();
    const result = await checkClusterReachable('my-cluster');
    expect(result).toEqual({ success: false, error: 'connection refused' });
  });

  test('returns failure when namespace API throws', async () => {
    mockClusterRequest.mockImplementation(() => {
      throw new Error('API not available');
    });
    const { checkClusterReachable } = await loadBareMetalProxyModule();
    const result = await checkClusterReachable('my-cluster');
    expect(result).toEqual({ success: false, error: 'API not available' });
  });
});

describe('stopBareMetalProxy', () => {
  beforeEach(() => {
    mockRunCommand.mockReset();
    mockClusterRequest.mockReset();
  });

  test('returns stopped when no session exists', async () => {
    const { stopBareMetalProxy } = await loadBareMetalProxyModule();
    const result = await stopBareMetalProxy('sub-1', 'rg-1', 'no-session-cluster');
    expect(result).toEqual({ success: true, status: 'stopped' });
  });
});
