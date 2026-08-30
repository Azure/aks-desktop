// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { isTokenValid, makeAzureAuth, runJsonCommand } from './index';

/** Minimal event emitter */
const makeEmitter = () => {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    on(event: string, cb: (...args: any[]) => void) {
      (handlers[event] ||= []).push(cb);
    },
    emit(event: string, ...args: any[]) {
      (handlers[event] || []).forEach(cb => cb(...args));
    },
  };
};

/** Fake child process plus a runCommand that returns it */
const makeFakeCommand = () => {
  const stdout = makeEmitter();
  const stderr = makeEmitter();
  const command = Object.assign(makeEmitter(), { stdout, stderr });
  const runCommand = (() => command) as unknown as Parameters<typeof runJsonCommand>[0];
  return { command, stdout, stderr, runCommand };
};

/**
 * A runner that records subcommand calls and asynchronously emits a scripted
 * response
 */
const makeRunner = (
  responder: (
    subcommand: string,
    calls: string[][]
  ) => { stdout?: string; stderr?: string; code?: number }
) => {
  const calls: string[][] = [];
  const runCommand = ((_cmd: string, args: string[]) => {
    const scriptArgs = args.slice(1); // drop 'az-auth/azure-api.js'
    calls.push(scriptArgs);
    const stdout = makeEmitter();
    const stderr = makeEmitter();
    const command = Object.assign(makeEmitter(), { stdout, stderr });
    queueMicrotask(() => {
      const r = responder(scriptArgs[0], calls);
      if (r.stdout !== undefined) stdout.emit('data', r.stdout);
      if (r.stderr !== undefined) stderr.emit('data', r.stderr);
      command.emit('exit', r.code ?? 0);
    });
    return command;
  }) as unknown as Parameters<typeof runJsonCommand>[0];
  return { runCommand, calls };
};

/** A token that stays valid well past the refresh margin */
const freshToken = () =>
  JSON.stringify({ token: 't', expiresOnTimestamp: Date.now() + 60 * 60_000 });

test('resolves with parsed JSON once the process exits successfully', async () => {
  const { command, stdout, runCommand } = makeFakeCommand();

  const result = runJsonCommand(runCommand, ['user-info'], 5000);
  stdout.emit('data', JSON.stringify({ isLoggedIn: true }));
  command.emit('exit', 0);

  await expect(result).resolves.toEqual({ isLoggedIn: true });
});

test('concatenates multiple stdout chunks before parsing', async () => {
  const { command, stdout, runCommand } = makeFakeCommand();

  const result = runJsonCommand(runCommand, ['user-info'], 5000);
  stdout.emit('data', '{"a":1,');
  stdout.emit('data', '"b":2}');
  command.emit('exit', 0);

  await expect(result).resolves.toEqual({ a: 1, b: 2 });
});

test('rejects with an invalid JSON error on success with unparseable output', async () => {
  const { command, stdout, runCommand } = makeFakeCommand();

  const result = runJsonCommand(runCommand, ['user-info'], 5000);
  stdout.emit('data', 'not json');
  command.emit('exit', 0);

  await expect(result).rejects.toThrow('azure-api user-info returned invalid JSON: not json');
});

test('truncates the invalid JSON output to 200 characters', async () => {
  const { command, stdout, runCommand } = makeFakeCommand();

  const result = runJsonCommand(runCommand, ['user-info'], 5000);
  stdout.emit('data', 'x'.repeat(500));
  command.emit('exit', 0);

  await expect(result).rejects.toThrow(`invalid JSON: ${'x'.repeat(200)}`);
});

test('rejects with trimmed stderr on a non-zero exit', async () => {
  const { command, stderr, runCommand } = makeFakeCommand();

  const result = runJsonCommand(runCommand, ['login'], 5000);
  stderr.emit('data', '  failed  \n');
  command.emit('exit', 1);

  await expect(result).rejects.toThrow('failed');
});

test('rejects with an exit-code message when stderr is empty', async () => {
  const { command, runCommand } = makeFakeCommand();

  const result = runJsonCommand(runCommand, ['login'], 5000);
  command.emit('exit', 3);

  await expect(result).rejects.toThrow('azure-api login exited with code 3');
});

test('rejects with a timeout error when the process never exits', async () => {
  vi.useFakeTimers();
  try {
    const { runCommand } = makeFakeCommand();

    const result = runJsonCommand(runCommand, ['get-token'], 5000);
    const assertion = expect(result).rejects.toThrow('azure-api get-token timed out after 5000ms');
    vi.advanceTimersByTime(5000);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});

test('ignores a late exit after the timeout has already rejected', async () => {
  vi.useFakeTimers();
  try {
    const { command, stdout, runCommand } = makeFakeCommand();

    const result = runJsonCommand(runCommand, ['get-token'], 5000);
    const assertion = expect(result).rejects.toThrow('timed out after 5000ms');
    vi.advanceTimersByTime(5000);
    await assertion;

    // A late exit must not settle the promise a second time or throw.
    stdout.emit('data', '{"token":"abc"}');
    expect(() => command.emit('exit', 0)).not.toThrow();
  } finally {
    vi.useRealTimers();
  }
});

describe('isTokenValid', () => {
  test('rejects an undefined result', () => {
    expect(isTokenValid(undefined)).toBe(false);
  });

  test('rejects a token without an expiry timestamp', () => {
    expect(isTokenValid({ token: 't' })).toBe(false);
  });

  test('rejects a token expiring within the refresh margin', () => {
    expect(isTokenValid({ token: 't', expiresOnTimestamp: Date.now() + 60_000 })).toBe(false);
  });

  test('accepts a token comfortably in the future', () => {
    expect(isTokenValid({ token: 't', expiresOnTimestamp: Date.now() + 60 * 60_000 })).toBe(true);
  });
});

describe('token cache', () => {
  test('serves a valid token from cache without a second call', async () => {
    const { runCommand, calls } = makeRunner(() => ({ stdout: freshToken() }));
    const auth = makeAzureAuth(runCommand);

    const first = await auth.azureCredential.getToken('scope-a');
    const second = await auth.azureCredential.getToken('scope-a');

    expect(second).toEqual(first);
    expect(calls.filter(c => c[0] === 'get-token')).toHaveLength(1);
  });

  test('keys the cache by scope', async () => {
    const { runCommand, calls } = makeRunner(() => ({ stdout: freshToken() }));
    const auth = makeAzureAuth(runCommand);

    await auth.azureCredential.getToken('scope-a');
    await auth.azureCredential.getToken('scope-b');

    expect(calls.filter(c => c[0] === 'get-token')).toHaveLength(2);
  });

  test('refetches once a cached token falls inside the refresh margin', async () => {
    const { runCommand, calls } = makeRunner(() => ({
      stdout: JSON.stringify({ token: 't', expiresOnTimestamp: Date.now() + 60_000 }),
    }));
    const auth = makeAzureAuth(runCommand);

    await auth.azureCredential.getToken('scope-a');
    await auth.azureCredential.getToken('scope-a');

    expect(calls.filter(c => c[0] === 'get-token')).toHaveLength(2);
  });

  test('evicts a failed fetch so the next call retries', async () => {
    const { runCommand, calls } = makeRunner((_sub, calls) =>
      calls.length === 1 ? { code: 1, stderr: 'nope' } : { stdout: freshToken() }
    );
    const auth = makeAzureAuth(runCommand);

    await expect(auth.azureCredential.getToken('scope-a')).rejects.toThrow('nope');
    await expect(auth.azureCredential.getToken('scope-a')).resolves.toMatchObject({ token: 't' });
    expect(calls.filter(c => c[0] === 'get-token')).toHaveLength(2);
  });
});

describe('login status cache', () => {
  test('memoizes the user-info lookup', async () => {
    const { runCommand, calls } = makeRunner(() => ({
      stdout: JSON.stringify({ isLoggedIn: true }),
    }));
    const auth = makeAzureAuth(runCommand);

    await auth.getLoginStatus();
    await auth.getLoginStatus();

    expect(calls.filter(c => c[0] === 'user-info')).toHaveLength(1);
  });

  test('clears the cache on failure so the next call retries', async () => {
    const { runCommand, calls } = makeRunner((_sub, calls) =>
      calls.length === 1
        ? { code: 1, stderr: 'down' }
        : { stdout: JSON.stringify({ isLoggedIn: true }) }
    );
    const auth = makeAzureAuth(runCommand);

    await expect(auth.getLoginStatus()).rejects.toThrow('down');
    await expect(auth.getLoginStatus()).resolves.toEqual({ isLoggedIn: true });
    expect(calls.filter(c => c[0] === 'user-info')).toHaveLength(2);
  });
});

describe('logout and login invalidation', () => {
  test('logout clears token and login-status caches', async () => {
    const { runCommand, calls } = makeRunner(sub =>
      sub === 'user-info'
        ? { stdout: JSON.stringify({ isLoggedIn: true }) }
        : sub === 'logout'
        ? { stdout: JSON.stringify({ success: true }) }
        : { stdout: freshToken() }
    );
    const auth = makeAzureAuth(runCommand);

    await auth.azureCredential.getToken('scope-a');
    await auth.getLoginStatus();
    await auth.logout();

    // Caches were cleared, so both lookups run again.
    await auth.azureCredential.getToken('scope-a');
    await auth.getLoginStatus();

    expect(calls.filter(c => c[0] === 'get-token')).toHaveLength(2);
    expect(calls.filter(c => c[0] === 'user-info')).toHaveLength(2);
  });

  test('initiateLogin invalidates a cached login status', async () => {
    const { runCommand, calls } = makeRunner(sub =>
      sub === 'login'
        ? { stdout: JSON.stringify({ success: true }) }
        : { stdout: JSON.stringify({ isLoggedIn: true }) }
    );
    const auth = makeAzureAuth(runCommand);

    await auth.getLoginStatus();
    await auth.initiateLogin();
    await auth.getLoginStatus();

    expect(calls.filter(c => c[0] === 'user-info')).toHaveLength(2);
  });
});
