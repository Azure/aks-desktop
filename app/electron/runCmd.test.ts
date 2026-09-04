/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventEmitter } from 'events';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { killAllProxies } from './proxies';
import {
  addRunCmdConsent,
  checkPermissionSecret,
  handleRunCommand,
  mergeCommandEnvironment,
  removeRunCmdConsent,
  setupRunCmdHandlers,
  validateCommandData,
} from './runCmd';
import { loadSettings, saveSettings } from './settings';

vi.mock('./plugin-management', () => ({
  defaultPluginsDir: vi.fn(() => '/plugins/default'),
  defaultUserPluginsDir: vi.fn(() => '/plugins/user'),
}));

vi.mock('./settings', () => ({
  loadSettings: vi.fn(() => ({
    confirmedCommands: { 'minikube start': true, gh: true, az: true },
  })),
  saveSettings: vi.fn(),
  SETTINGS_PATH: '/fake/settings.json',
}));

vi.mock('./i18next.config', () => ({
  default: { t: (s: string) => s },
}));

describe('AI Assistant runCmd consent', () => {
  const aiAssistantCommands = ['gh auth', 'az account', 'az cognitiveservices'];
  const defaultSettings = {
    confirmedCommands: { 'minikube start': true, gh: true, az: true },
  };

  beforeEach(() => {
    vi.mocked(saveSettings).mockClear();
  });

  afterEach(() => {
    vi.mocked(loadSettings).mockReturnValue(defaultSettings);
  });

  it('adds consent for the canonical package name', () => {
    const settings = { confirmedCommands: {} as Record<string, boolean> };
    vi.mocked(loadSettings).mockReturnValue(settings);

    addRunCmdConsent({ name: '@headlamp-k8s/ai-assistant' });

    expect(settings.confirmedCommands).toEqual(
      Object.fromEntries(aiAssistantCommands.map(command => [command, true]))
    );
    expect(saveSettings).toHaveBeenCalledOnce();
  });

  it('removes consent using the package name', () => {
    const settings = {
      confirmedCommands: Object.fromEntries(
        aiAssistantCommands.map(command => [command, true])
      ) as Record<string, boolean>,
    };
    vi.mocked(loadSettings).mockReturnValue(settings);

    removeRunCmdConsent('@headlamp-k8s/ai-assistant');

    expect(settings.confirmedCommands).toEqual({});
    expect(saveSettings).toHaveBeenCalledOnce();
  });
});

describe('checkPermissionSecret', () => {
  const baseCommandData = {
    id: '1',
    command: 'minikube',
    args: [],
    options: {},
    permissionSecrets: {},
  };

  it('returns true when permission secret matches for minikube', () => {
    const permissionSecrets = { 'runCmd-minikube': 123 };
    const commandData = {
      ...baseCommandData,
      permissionSecrets: { 'runCmd-minikube': 123 },
    };
    expect(checkPermissionSecret(commandData, permissionSecrets)[0]).toBe(true);
  });

  it('returns false when permission secret is missing', () => {
    const permissionSecrets = {};
    const commandData = {
      ...baseCommandData,
      permissionSecrets: {},
    };
    expect(checkPermissionSecret(commandData, permissionSecrets)[0]).toBe(false);
  });

  it('returns false when permission secret does not match', () => {
    const permissionSecrets = { 'runCmd-minikube': 123 };
    const commandData = {
      ...baseCommandData,
      permissionSecrets: { 'runCmd-minikube': 456 },
    };
    expect(checkPermissionSecret(commandData, permissionSecrets)[0]).toBe(false);
  });

  it('returns true for scriptjs with correct permission secret', () => {
    const permissionSecrets = { 'runCmd-scriptjs-myscript.js': 42 };
    const commandData = {
      ...baseCommandData,
      command: 'scriptjs',
      args: ['myscript.js'],
      permissionSecrets: { 'runCmd-scriptjs-myscript.js': 42 },
    };
    expect(checkPermissionSecret(commandData, permissionSecrets)[0]).toBe(true);
  });

  it('returns false for scriptjs with missing permission secret', () => {
    const permissionSecrets = {};
    const commandData = {
      ...baseCommandData,
      command: 'scriptjs',
      args: ['myscript.js'],
      permissionSecrets: {},
    };
    expect(checkPermissionSecret(commandData, permissionSecrets)[0]).toBe(false);
  });

  it('returns false for scriptjs with mismatched permission secret', () => {
    const permissionSecrets = { 'runCmd-scriptjs-myscript.js': 42 };
    const commandData = {
      ...baseCommandData,
      command: 'scriptjs',
      args: ['myscript.js'],
      permissionSecrets: { 'runCmd-scriptjs-myscript.js': 99 },
    };
    expect(checkPermissionSecret(commandData, permissionSecrets)[0]).toBe(false);
  });

  // it works for windows paths in like plugins\minikube/myscript.js
  it('handles Windows paths in scriptjs command', () => {
    const permissionSecrets = { 'runCmd-scriptjs-plugins/minikube/myscript.js': 42 };
    const commandData = {
      ...baseCommandData,
      command: 'scriptjs',
      args: ['plugins\\minikube/myscript.js'],
      permissionSecrets: { 'runCmd-scriptjs-plugins/minikube/myscript.js': 42 },
    };
    expect(checkPermissionSecret(commandData, permissionSecrets)[0]).toBe(true);
  });
});

describe('mergeCommandEnvironment', () => {
  it('uses the current process PATH instead of a stale cached Windows Path', async () => {
    await withPlatform('win32', () => {
      const originalPath = process.env.PATH;
      process.env.PATH = 'C:\\app\\resources\\external-tools\\az-cli\\win32\\bin;C:\\Windows';
      try {
        const env = mergeCommandEnvironment({ Path: 'C:\\Windows', PATH: 'C:\\stale' });
        expect(env.PATH).toBe(process.env.PATH);
        expect('Path' in env).toBe(false);
      } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
      }
    });
  });

  it('honors an explicit PATH override for one command', async () => {
    await withPlatform('win32', () => {
      const env = mergeCommandEnvironment({ Path: 'C:\\cached' }, { Path: 'C:\\command-specific' });
      expect(env.PATH).toBe('C:\\command-specific');
      expect('Path' in env).toBe(false);
    });
  });
});

describe('validateCommandData', () => {
  it('returns false if eventData is not an object', () => {
    expect(validateCommandData(null as any)[0]).toBe(false);
    expect(validateCommandData(undefined as any)[0]).toBe(false);
    expect(validateCommandData('string' as any)[0]).toBe(false);
  });

  it('returns false if command is missing or not a string', () => {
    expect(validateCommandData({ args: [], options: {}, permissionSecrets: {} })[0]).toBe(false);
    expect(
      validateCommandData({ command: 123 as any, args: [], options: {}, permissionSecrets: {} })[0]
    ).toBe(false);
    expect(
      validateCommandData({ command: '', args: [], options: {}, permissionSecrets: {} })[0]
    ).toBe(false);
  });

  it('returns false if args is not an array', () => {
    expect(
      validateCommandData({
        command: 'minikube',
        args: 'not-array' as any,
        options: {},
        permissionSecrets: {},
      })[0]
    ).toBe(false);
  });

  it('returns false if options is not an object', () => {
    expect(
      validateCommandData({
        command: 'minikube',
        args: [],
        options: null as any,
        permissionSecrets: {},
      })[0]
    ).toBe(false);
    expect(
      validateCommandData({
        command: 'minikube',
        args: [],
        options: 123 as any,
        permissionSecrets: {},
      })[0]
    ).toBe(false);
  });

  it('returns false if permissionSecrets is not an object', () => {
    expect(
      validateCommandData({
        command: 'minikube',
        args: [],
        options: {},
        permissionSecrets: null as any,
      })[0]
    ).toBe(false);
    expect(
      validateCommandData({
        command: 'minikube',
        args: [],
        options: {},
        permissionSecrets: 123 as any,
      })[0]
    ).toBe(false);
  });

  it('returns false if any permissionSecret value is not a number', () => {
    expect(
      validateCommandData({
        command: 'minikube',
        args: [],
        options: {},
        permissionSecrets: { foo: undefined as any },
      })[0]
    ).toBe(false);
  });

  it('returns false if command is not in validCommands', () => {
    expect(
      validateCommandData({
        command: 'invalidcmd',
        args: [],
        options: {},
        permissionSecrets: {},
      })[0]
    ).toBe(false);
  });

  it('returns true for valid minikube command', () => {
    expect(
      validateCommandData({
        command: 'minikube',
        args: [],
        options: {},
        permissionSecrets: { 'runCmd-minikube': 123 },
      })[0]
    ).toBe(true);
  });

  it('returns true for valid az command', () => {
    expect(
      validateCommandData({
        command: 'az',
        args: ['arg1'],
        options: {},
        permissionSecrets: {},
      })[0]
    ).toBe(true);
  });

  it('returns true for valid gh command', () => {
    expect(
      validateCommandData({
        command: 'gh',
        args: ['auth', 'token'],
        options: {},
        permissionSecrets: {},
      })[0]
    ).toBe(true);
  });

  it('returns true for valid scriptjs command', () => {
    expect(
      validateCommandData({
        command: 'scriptjs',
        args: ['myscript.js'],
        options: {},
        permissionSecrets: { 'runCmd-scriptjs-myscript.js': 42 },
      })[0]
    ).toBe(true);
  });
});

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('./main', () => ({
  getShellEnvironment: vi.fn(async () => ({})),
}));

describe('handleRunCommand - child process error event', () => {
  it('sends command-stderr and command-exit with -1 when child emits error', async () => {
    const childEmitter = new EventEmitter() as any;
    childEmitter.stdout = new EventEmitter();
    childEmitter.stderr = new EventEmitter();

    const { spawn } = await import('child_process');
    (spawn as Mock).mockReturnValue(childEmitter);

    const sentMessages: Array<[string, ...unknown[]]> = [];
    const fakeEvent = {
      sender: {
        send: vi.fn((...args: [string, ...unknown[]]) => sentMessages.push(args)),
      },
    } as any;

    const fakeMainWindow = { id: 1 } as any;
    const permissionSecrets = { 'runCmd-minikube': 99 };

    const eventData = {
      id: 'test-id',
      command: 'minikube',
      args: ['start'],
      options: {},
      permissionSecrets: { 'runCmd-minikube': 99 },
    };

    await handleRunCommand(fakeEvent, eventData, fakeMainWindow, permissionSecrets);

    const err = new Error('spawn error');
    childEmitter.emit('error', err);

    expect(sentMessages).toContainEqual(['command-stderr', 'test-id', 'spawn error']);
    expect(sentMessages).toContainEqual(['command-exit', 'test-id', -1]);
  });
});

describe('handleRunCommand - command environment', () => {
  it('passes per-command env overrides through to the spawned process', async () => {
    const childEmitter = new EventEmitter() as any;
    childEmitter.stdout = new EventEmitter();
    childEmitter.stderr = new EventEmitter();

    const { spawn } = await import('child_process');
    (spawn as Mock).mockReset();
    (spawn as Mock).mockReturnValue(childEmitter);

    const fakeEvent = { sender: { send: vi.fn() } } as any;

    await handleRunCommand(
      fakeEvent,
      {
        id: 'env-id',
        command: 'minikube',
        args: ['start'],
        options: { env: { HEADLAMP_TEST_VAR: 'from-command' } },
        permissionSecrets: { 'runCmd-minikube': 99 },
      },
      { id: 1 } as any,
      { 'runCmd-minikube': 99 }
    );

    const spawnEnv = (spawn as Mock).mock.calls[0][2].env;
    expect(spawnEnv.HEADLAMP_TEST_VAR).toBe('from-command');
  });
});

describe('runScript', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalConsoleError = console.error;
  const originalResourcesPath = process.resourcesPath;

  let exitMock: Mock;
  let consoleErrorMock: Mock;
  beforeEach(() => {
    vi.resetModules();
    // @ts-ignore this is fine for tests
    process.resourcesPath = '/resources';

    exitMock = vi.fn() as any;
    // @ts-expect-error overriding for test
    process.exit = exitMock;
    consoleErrorMock = vi.fn();
    console.error = consoleErrorMock;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    console.error = originalConsoleError;
    // @ts-ignore
    process.resourcesPath = originalResourcesPath;
    vi.restoreAllMocks();
  });

  const testScriptImport = async (scriptPath: string) => {
    const resolvedPath = path.resolve(scriptPath);
    process.argv = ['node', resolvedPath];
    vi.doMock(resolvedPath, () => ({}));
    const runCmdModule = await import('./runCmd');
    runCmdModule.runScript();
    expect(exitMock).not.toHaveBeenCalled();
  };

  it('imports the script when path is inside defaultPluginsDir', () =>
    testScriptImport('/plugins/default/my-script.js'));

  it('imports the script when path is inside defaultUserPluginsDir', () =>
    testScriptImport('/plugins/user/my-script.js'));

  it('imports the script when path is inside static .plugins dir', () =>
    testScriptImport('/resources/.plugins/my-script.js'));

  it('exits with error when script is outside allowed directories', async () => {
    const scriptPath = path.resolve('/not-allowed/my-script.js');
    process.argv = ['node', scriptPath];
    vi.doMock(scriptPath, () => ({}));

    const runCmdModule = await import('./runCmd');
    runCmdModule.runScript();

    expect(consoleErrorMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});

/**
 * Pins `process.platform` for the duration of `fn`. Proxy teardown branches on
 * it -- POSIX signals the process group, Windows shells out to taskkill -- so a
 * test has to state which one it describes instead of inheriting the runner's.
 *
 * @param platform - Platform value exposed to the code under test.
 * @param fn - Test operation to run while the platform override is active.
 * @returns A promise that settles after the operation and platform restoration.
 */
async function withPlatform(platform: string, fn: () => Promise<void> | void) {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

describe('killAllProxies - quit during an in-flight proxy start', () => {
  /** A stand-in for the spawned `az connectedk8s proxy` child. */
  function fakeChild() {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn();
    return child;
  }

  async function spawnProxy(cluster: string, child: any) {
    // Consent is keyed on `command + ' ' + args[0]`, so pre-confirm the proxy
    // invocation to keep the dialog out of this test.
    (loadSettings as Mock).mockReturnValue({
      confirmedCommands: { 'az connectedk8s': true },
    });
    const { spawn } = await import('child_process');
    (spawn as Mock).mockReturnValue(child);
    const fakeEvent = { sender: { send: vi.fn() } } as any;
    await handleRunCommand(
      fakeEvent,
      {
        id: `proxy:${cluster}`,
        command: 'az',
        args: ['connectedk8s', 'proxy', '-n', cluster],
        options: { cluster },
        permissionSecrets: { 'runCmd-az': 7 },
      },
      { id: 1 } as any,
      { 'runCmd-az': 7 }
    );
  }

  it('kills a proxy that finishes spawning after the app began quitting', async () =>
    withPlatform('linux', async () => {
      // The race: `killAllProxies` runs while the start is still awaiting shell
      // setup, so it sees nothing to kill; the child appears moments later and
      // would otherwise outlive the app, holding the arcProxy ports.
      killAllProxies();

      const child = fakeChild();
      await spawnProxy('late-cluster', child);

      expect(child.kill).toHaveBeenCalledTimes(1);
      // Killed rather than tracked: a later teardown must not signal it again,
      // by then its pid may belong to something else.
      killAllProxies();
      expect(child.kill).toHaveBeenCalledTimes(1);
    }));
});

describe('AKS Hybrid & Edge proxy lifecycle', () => {
  /** A stand-in for the spawned `az connectedk8s proxy` child. */
  function proxyChild(pid = 4242) {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = pid;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn();
    return child;
  }

  /**
   * Registers the real IPC handlers against a fake `ipcMain` that just records
   * them, so the start/stop paths can be driven directly.
   */
  function setupHandlers() {
    const handlers: Record<string, (...args: any[]) => any> = {};
    const register = (channel: string, fn: any) => (handlers[channel] = fn);
    const fakeIpcMain = { on: register, handle: register } as any;
    const fakeMainWindow = { webContents: { on: vi.fn(), send: vi.fn() } } as any;
    setupRunCmdHandlers(fakeMainWindow, fakeIpcMain);
    return handlers;
  }

  const startPayload = (cluster: string) => ({
    cluster,
    subscriptionId: '00000000-0000-0000-0000-000000000000',
    resourceGroup: 'rg',
  });

  const fakeEvent = () => ({ sender: { send: vi.fn() } } as any);

  beforeEach(async () => {
    (loadSettings as Mock).mockReturnValue({ confirmedCommands: { 'az connectedk8s': true } });
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { spawn } = await import('child_process');
    (spawn as Mock).mockReset();
  });

  afterEach(() => {
    killAllProxies();
    vi.mocked(process.kill).mockClear();
  });

  it.each([
    {
      cluster: 'cluster;calc',
      subscriptionId: startPayload('valid').subscriptionId,
      resourceGroup: 'rg',
    },
    { cluster: 'valid', subscriptionId: 'sub && calc', resourceGroup: 'rg' },
    {
      cluster: 'valid',
      subscriptionId: startPayload('valid').subscriptionId,
      resourceGroup: 'rg | calc',
    },
  ])('rejects an unsafe proxy target before spawning: $cluster', async payload => {
    const { spawn } = await import('child_process');
    const handlers = setupHandlers();

    await expect(handlers['start-cluster-proxy'](fakeEvent(), payload)).resolves.toEqual({
      success: false,
      error: 'Cluster proxy target is invalid.',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('shares an in-flight start failure with duplicate callers', async () => {
    // Both events arrive before the child is tracked. They must share the first
    // result rather than spawning twice or reporting premature success.
    const { spawn } = await import('child_process');
    const child = proxyChild();
    child.pid = undefined;
    (spawn as Mock).mockReturnValue(child);
    const handlers = setupHandlers();

    const firstStart = handlers['start-cluster-proxy'](fakeEvent(), startPayload('dupe'));
    const duplicateStart = handlers['start-cluster-proxy'](fakeEvent(), startPayload('dupe'));
    await new Promise(resolve => setTimeout(resolve, 0));
    child.emit('error', new Error('spawn az ENOENT'));

    await expect(Promise.all([firstStart, duplicateStart])).resolves.toEqual([
      { success: false, error: 'spawn az ENOENT' },
      { success: false, error: 'spawn az ENOENT' },
    ]);

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('holds the next cluster until the first proxy reports ready, not merely spawned', async () => {
    // arcProxy takes seconds to bind after `az` is spawned. A second start
    // arriving in that window races the daemon bootstrap and loses, leaving its
    // cluster unregistered — so spawning is not a sufficient release signal.
    const { spawn } = await import('child_process');
    const first = proxyChild(1111);
    const second = proxyChild(2222);
    (spawn as Mock).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const handlers = setupHandlers();

    const a = handlers['start-cluster-proxy'](fakeEvent(), startPayload('cluster-a'));
    await a;
    const b = handlers['start-cluster-proxy'](fakeEvent(), startPayload('cluster-b'));
    await new Promise(resolve => setTimeout(resolve, 0));

    // A is spawned but still bootstrapping the daemon, so B has not started.
    expect(spawn).toHaveBeenCalledTimes(1);

    // The signal the CLI emits once the cluster is registered and usable — not
    // "Proxy is listening on port …", which it prints before registering.
    first.stdout.emit('data', "Start sending kubectl requests on 'cluster-a' context\n");
    await b;

    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('recognises the readiness line even when stdout splits it across chunks', async () => {
    // stdout is a byte stream; matching each chunk alone would miss this and hold
    // every queued cluster until the 30s timeout.
    const { spawn } = await import('child_process');
    const first = proxyChild(5555);
    const second = proxyChild(6666);
    (spawn as Mock).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const handlers = setupHandlers();

    await handlers['start-cluster-proxy'](fakeEvent(), startPayload('split-a'));
    const b = handlers['start-cluster-proxy'](fakeEvent(), startPayload('split-b'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(spawn).toHaveBeenCalledTimes(1);

    first.stdout.emit('data', 'Start sending kub');
    first.stdout.emit('data', "ectl requests on 'split-a' context\n");
    await b;

    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('releases the queue when the spawn fails, which emits error and may never exit', async () => {
    // A missing or broken `az` emits 'error' with no 'exit'; without observing it
    // the queue would stay blocked for the full readiness timeout.
    const { spawn } = await import('child_process');
    const first = proxyChild(7777);
    const second = proxyChild(8888);
    (spawn as Mock).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const handlers = setupHandlers();

    await handlers['start-cluster-proxy'](fakeEvent(), startPayload('broken-a'));
    const b = handlers['start-cluster-proxy'](fakeEvent(), startPayload('broken-b'));
    first.emit('error', new Error('spawn az ENOENT'));
    await b;

    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('returns an immediate failure when the proxy process cannot spawn', async () => {
    const { spawn } = await import('child_process');
    const child = proxyChild();
    child.pid = undefined;
    (spawn as Mock).mockReturnValue(child);
    const handlers = setupHandlers();

    const start = handlers['start-cluster-proxy'](fakeEvent(), startPayload('missing-az'));
    await new Promise(resolve => setTimeout(resolve, 0));
    child.emit('error', new Error('spawn az ENOENT'));

    await expect(start).resolves.toEqual({ success: false, error: 'spawn az ENOENT' });
  });

  it('releases the queue when a proxy exits instead of reporting ready', async () => {
    // The register-and-exit case: a daemon was already running, so the CLI
    // registers its route and exits. Nothing to wait for.
    const { spawn } = await import('child_process');
    const first = proxyChild(3333);
    const second = proxyChild(4444);
    (spawn as Mock).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const handlers = setupHandlers();

    await handlers['start-cluster-proxy'](fakeEvent(), startPayload('exits-a'));
    const b = handlers['start-cluster-proxy'](fakeEvent(), startPayload('exits-b'));
    first.emit('exit', 1, null);
    await b;

    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('hides the console window on Windows, where a detached child would open one', async () => {
    await withPlatform('win32', async () => {
      const { spawn } = await import('child_process');
      (spawn as Mock).mockReturnValue(proxyChild());
      const handlers = setupHandlers();

      await handlers['start-cluster-proxy'](fakeEvent(), startPayload('hidden'));

      expect(spawn).toHaveBeenCalledWith(
        'az',
        expect.any(Array),
        expect.objectContaining({ windowsHide: true, shell: false })
      );
    });
  });

  it('stops tracking a proxy once its child exits, so quit does not signal a dead pid', async () =>
    withPlatform('linux', async () => {
      // A pid can be reused; signalling one that already exited on quit could hit
      // an unrelated process.
      const child = proxyChild(4242);
      const { spawn } = await import('child_process');
      (spawn as Mock).mockReturnValue(child);
      const killSpy = vi.mocked(process.kill);
      const handlers = setupHandlers();

      await handlers['start-cluster-proxy'](fakeEvent(), startPayload('exiting'));
      child.emit('exit', 0, null);

      killAllProxies();

      expect(killSpy).not.toHaveBeenCalled();
    }));

  it('signals the whole process group on POSIX so the arcProxy daemon goes too', async () =>
    withPlatform('linux', async () => {
      // `az connectedk8s proxy` spawns arcProxy as a separate process; signalling
      // only the CLI would leave the daemon holding the client-proxy ports after
      // the app has quit.
      const child = proxyChild(5150);
      const { spawn } = await import('child_process');
      (spawn as Mock).mockReturnValue(child);
      const killSpy = vi.mocked(process.kill);
      const handlers = setupHandlers();

      await handlers['start-cluster-proxy'](fakeEvent(), startPayload('posix'));
      killAllProxies();

      expect(killSpy).toHaveBeenCalledWith(-5150, 'SIGKILL');
    }));

  it('kills the child tree with taskkill on Windows, where process groups do not exist', async () =>
    withPlatform('win32', async () => {
      const child = proxyChild(6060);
      const { spawn } = await import('child_process');
      (spawn as Mock).mockReturnValue(child);
      const handlers = setupHandlers();

      await handlers['start-cluster-proxy'](fakeEvent(), startPayload('windows'));
      (spawn as Mock).mockClear();
      (spawn as Mock).mockReturnValue(Object.assign(new EventEmitter(), { on: vi.fn() }));

      killAllProxies();

      expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid', '6060', '/T', '/F']);
    }));
});
