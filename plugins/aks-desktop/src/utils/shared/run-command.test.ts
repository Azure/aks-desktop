// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Store event handlers registered by runCommandAsync so tests can trigger them.
type EventCallback = (...args: any[]) => void;

interface MockCmd {
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
}

function createMockCmd(): { cmd: MockCmd; handlers: Record<string, EventCallback> } {
  const handlers: Record<string, EventCallback> = {};

  const cmd: MockCmd = {
    stdout: {
      on: vi.fn((event: string, cb: EventCallback) => {
        handlers[`stdout:${event}`] = cb;
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: EventCallback) => {
        handlers[`stderr:${event}`] = cb;
      }),
    },
    on: vi.fn((event: string, cb: EventCallback) => {
      handlers[event] = cb;
    }),
  };

  return { cmd, handlers };
}

// We need to control the global `pluginRunCommand` that run-command.ts declares.
// Since it reads the global at call-time (typeof check), we assign/delete on globalThis.
const mockPluginRunCommand = vi.fn();

beforeEach(() => {
  (globalThis as any).pluginRunCommand = mockPluginRunCommand;
});

afterEach(() => {
  delete (globalThis as any).pluginRunCommand;
  vi.restoreAllMocks();
});

const { runCommandAsync } = await import('./run-command');

describe('runCommandAsync', () => {
  test('resolves with stdout and empty stderr on successful exit', async () => {
    const { cmd, handlers } = createMockCmd();
    mockPluginRunCommand.mockReturnValue(cmd);

    const promise = runCommandAsync('echo', ['hello']);

    // Simulate stdout data and successful exit.
    handlers['stdout:data']('hello world');
    handlers['exit'](0);

    const result = await promise;
    expect(result).toEqual({ stdout: 'hello world', stderr: '' });
  });

  test('resolves with stderr when command writes to stderr', async () => {
    const { cmd, handlers } = createMockCmd();
    mockPluginRunCommand.mockReturnValue(cmd);

    const promise = runCommandAsync('az', ['login']);

    handlers['stderr:data']('some warning');
    handlers['exit'](0);

    const result = await promise;
    expect(result).toEqual({ stdout: '', stderr: 'some warning' });
  });

  test('populates stderr when exit code is non-zero and stderr is empty', async () => {
    const { cmd, handlers } = createMockCmd();
    mockPluginRunCommand.mockReturnValue(cmd);

    const promise = runCommandAsync('false', []);

    handlers['exit'](1);

    const result = await promise;
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Command exited with code 1');
  });

  test('preserves stderr when exit code is non-zero and stderr already has content', async () => {
    const { cmd, handlers } = createMockCmd();
    mockPluginRunCommand.mockReturnValue(cmd);

    const promise = runCommandAsync('az', ['bad-command']);

    handlers['stderr:data']('ERROR: bad-command is not a valid command');
    handlers['exit'](2);

    const result = await promise;
    expect(result.stderr).toBe('ERROR: bad-command is not a valid command');
  });

  test('resolves with error message when error event fires', async () => {
    const { cmd, handlers } = createMockCmd();
    mockPluginRunCommand.mockReturnValue(cmd);

    const promise = runCommandAsync('nonexistent', []);

    handlers['error'](new Error('spawn nonexistent ENOENT'));

    const result = await promise;
    expect(result).toEqual({
      stdout: '',
      stderr: 'Command execution error: spawn nonexistent ENOENT',
    });
  });

  test('resolves with error message when error event fires with a code number', async () => {
    const { cmd, handlers } = createMockCmd();
    mockPluginRunCommand.mockReturnValue(cmd);

    const promise = runCommandAsync('cmd', []);

    handlers['error'](127);

    const result = await promise;
    expect(result).toEqual({
      stdout: '',
      stderr: 'Command execution error: 127',
    });
  });

  test('resolves with error when pluginRunCommand is not available', async () => {
    delete (globalThis as any).pluginRunCommand;

    const result = await runCommandAsync('az', ['version']);

    expect(result).toEqual({
      stdout: '',
      stderr: 'pluginRunCommand is not available.',
    });
  });

  test('resolves with error when pluginRunCommand throws synchronously', async () => {
    mockPluginRunCommand.mockImplementation(() => {
      throw new Error('bridge not ready');
    });

    const result = await runCommandAsync('az', ['version']);

    expect(result).toEqual({
      stdout: '',
      stderr: 'Failed to execute command: bridge not ready',
    });
  });

  test('resolves only once when both error and exit fire', async () => {
    const { cmd, handlers } = createMockCmd();
    mockPluginRunCommand.mockReturnValue(cmd);

    const promise = runCommandAsync('bad', []);

    // Node child_process can emit both 'error' and 'exit' for the same process.
    handlers['error'](new Error('spawn bad ENOENT'));
    handlers['exit'](1);

    const result = await promise;
    // The first event (error) wins.
    expect(result).toEqual({
      stdout: '',
      stderr: 'Command execution error: spawn bad ENOENT',
    });
  });

  test('concatenates multiple stdout chunks', async () => {
    const { cmd, handlers } = createMockCmd();
    mockPluginRunCommand.mockReturnValue(cmd);

    const promise = runCommandAsync('az', ['account', 'list']);

    handlers['stdout:data']('chunk1');
    handlers['stdout:data']('chunk2');
    handlers['exit'](0);

    const result = await promise;
    expect(result.stdout).toBe('chunk1chunk2');
  });
});
