// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Runs Windows batch files (`.cmd`/`.bat`) without a general-purpose shell.
 *
 * Node refuses to spawn batch files directly (`EINVAL`, since CVE-2024-27980), so they must
 * be run through `cmd.exe`. This builds a `cmd.exe /d /s /c` command line from the in-box
 * `cmd.exe`, quoting the script path and accepting only plain arguments, so nothing in the
 * path or arguments can be interpreted as cmd syntax.
 */

import { spawnSync } from 'node:child_process';

import { windowsSystemToolPath } from './windows-zip-extraction';

const PLAIN_ARGUMENT = /^[A-Za-z0-9._:=\\/-]+$/;

/** Returns spawn arguments that run a batch file through the in-box `cmd.exe`. */
export function windowsBatchInvocation(
  scriptPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
) {
  if (!/\.(cmd|bat)$/i.test(scriptPath)) {
    throw new Error(`Expected a .cmd or .bat file: ${scriptPath}`);
  }
  if (/["%!\r\n]/.test(scriptPath)) {
    throw new Error(`Batch file path contains characters cmd.exe would interpret: ${scriptPath}`);
  }
  const unsafe = args.find(arg => !PLAIN_ARGUMENT.test(arg));
  if (unsafe !== undefined) {
    throw new Error(`Batch file argument must be plain text without spaces or cmd syntax: ${unsafe}`);
  }
  return {
    command: windowsSystemToolPath('cmd.exe', env),
    // /s with outer quotes makes cmd.exe strip exactly one pair, keeping the quoted path intact.
    args: ['/d', '/s', '/c', `""${scriptPath}" ${args.join(' ')}"`],
    windowsVerbatimArguments: true,
  };
}

interface RunOptions {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

/** Runs a batch file and returns its stdout; throws if it cannot start or exits non-zero. */
export function runWindowsBatch(
  scriptPath: string,
  args: readonly string[],
  options: RunOptions = {}
): string {
  const env = options.env ?? process.env;
  const invocation = windowsBatchInvocation(scriptPath, args, env);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    env,
    timeout: options.timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(
      `${scriptPath} ${args.join(' ')} exited with ${result.status ?? result.signal}${detail ? `: ${detail}` : ''}`
    );
  }
  return result.stdout;
}
