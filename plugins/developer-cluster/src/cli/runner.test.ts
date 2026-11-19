// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliCommandError, runCli, RunningCommand } from './runner';

type Listener = (value: unknown) => void;

function start() {
  const stdout: Listener[] = [];
  const exit: Listener[] = [];
  const command: RunningCommand = {
    stdout: { on: (_event, listener) => stdout.push(listener) },
    stderr: { on: () => undefined },
    on: (_event, listener) => exit.push(listener),
  };
  const run = vi.fn(() => command);
  vi.stubGlobal('pluginRunCommand', run);
  return {
    run,
    promise: runCli(['cluster', 'show']),
    out: (chunk: string) => stdout.forEach(listener => listener(chunk)),
    exit: (code: unknown) => exit.forEach(listener => listener(code)),
  };
}

function event(phase: string, level: string, data?: Record<string, unknown>): string {
  return JSON.stringify({ ts: '', phase, level, msg: '', ...(data && { data }) }) + '\n';
}

async function failure(promise: Promise<unknown>): Promise<CliCommandError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(CliCommandError);
  return error as CliCommandError;
}

describe('runCli', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves with the result and ignores guest and progress output', async () => {
    const command = start();
    command.out(event('provision', 'info') + 'not json\n');
    command.out(
      JSON.stringify({ phase: 'provision', level: 'info', msg: 'token: ' + 'a'.repeat(20) })
    );
    command.out('\n' + 'x'.repeat(70 * 1024) + '\n');
    const result = event('result', 'info', { context: 'dev', path: '/k' });
    command.out(result.slice(0, 10));
    command.out(result.slice(10, -1));
    command.exit(0);

    await expect(command.promise).resolves.toStrictEqual({
      level: 'info',
      data: { context: 'dev', path: '/k' },
    });
    expect(command.run).toHaveBeenCalledWith('aks-devctl', ['cluster', 'show'], {});
  });

  it('keeps the last result and reads CRLF lines', async () => {
    const command = start();
    command.out(event('result', 'info', { n: 1 }).replace('\n', '\r\n'));
    command.out(event('result', 'warn', { n: 2 }).replace('\n', '\r\n'));
    command.exit(0);
    await expect(command.promise).resolves.toStrictEqual({ level: 'warn', data: { n: 2 } });
  });

  it('fails when the CLI reports an error event, even on exit 0', async () => {
    const command = start();
    command.out(event('error', 'error', { error: 'boom' }) + event('result', 'info', {}));
    command.exit(0);
    expect((await failure(command.promise)).code).toBe('failed');
  });

  it.each([
    [-2, false, 'denied'],
    [-3, false, 'denied'],
    [-1, false, 'unavailable'],
    [-1, true, 'exit'],
    [1, false, 'exit'],
    [null, false, 'exit'],
    [0, false, 'missing-terminal'],
    ['lost', false, 'exit'],
  ])('maps exit %s (stdout %s) to %s', async (code, output, expected) => {
    const command = start();
    if (output) command.out(event('provision', 'info'));
    command.exit(code);
    expect((await failure(command.promise)).code).toBe(expected);
  });

  it('fails as exit when a listener cannot be attached', async () => {
    const attach = () => {
      throw new Error('detached');
    };
    vi.stubGlobal('pluginRunCommand', () => ({ stdout: { on: attach }, stderr: {}, on: attach }));
    expect((await failure(runCli(['cluster', 'show']))).code).toBe('exit');
  });

  it('is unavailable outside AKS Desktop', async () => {
    vi.stubGlobal('pluginRunCommand', undefined);
    expect((await failure(runCli(['cluster', 'show']))).code).toBe('unavailable');
  });
});
