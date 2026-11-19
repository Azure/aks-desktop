// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunningCommand } from '../cli/runner';
import { inspectWsl } from './platformChecks';

type Listener = (value: unknown) => void;

interface Reply {
  readonly code: number;
  readonly stdout?: string;
}

/** Answers `wsl --status` and the `reg query` of WSL's default version. */
function stubQueries(status: Reply, defaults: Reply) {
  const run = vi.fn<(tool: string, args: string[]) => RunningCommand>(tool => {
    const reply = tool === 'wsl' ? status : defaults;
    const stdout: Listener[] = [];
    const exit: Listener[] = [];
    setTimeout(() => {
      if (reply.stdout !== undefined) stdout.forEach(listener => listener(reply.stdout));
      exit.forEach(listener => listener(reply.code));
    });
    return {
      stdout: { on: (_event, listener) => stdout.push(listener) },
      stderr: { on: () => undefined },
      on: (_event, listener) => exit.push(listener),
    };
  });
  vi.stubGlobal('pluginRunCommand', run);
  return run;
}

describe('inspectWsl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['0x2', 'ready'],
    ['0x1', 'manual-setup-required'],
  ])('checks the default version %s and no installed distribution', async (value, wsl) => {
    const run = stubQueries(
      { code: 0 },
      { code: 0, stdout: `\r\n    DefaultVersion    REG_DWORD    ${value}\r\n` }
    );
    await expect(inspectWsl()).resolves.toStrictEqual({ wsl });
    expect(run.mock.calls.map(([tool, args]) => [tool, args[0]])).toStrictEqual([
      ['wsl', '--status'],
      ['reg', 'query'],
    ]);
  });

  it('treats an absent default version as WSL 2, as the CLI does', async () => {
    stubQueries({ code: 0 }, { code: 1 });
    await expect(inspectWsl()).resolves.toStrictEqual({ wsl: 'ready' });
  });
});
