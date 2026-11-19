// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Runs one granted `aks-devctl` command through AKS Desktop and reads its JSON Lines stdout. The
// runner keeps the last `result` event, notes any `error` event and ignores every other line and
// stderr. It never kills, times out, logs or displays anything, and it settles exactly once, on
// Desktop's exit event.

import { isRecord } from '../contract/capability';
import { CLI_COMMAND, CliErrorCode } from '../contract/devctl';

/**
 * The object Headlamp's `runCommand` returns (headlamp-plugin
 * lib/components/App/runCommand.js). Listeners receive the event detail itself: a stdout or
 * stderr chunk, or the exit code.
 */
export interface CommandStream {
  on(event: 'data', listener: (chunk: unknown) => void): void;
}

export interface RunningCommand {
  stdout: CommandStream;
  stderr: CommandStream;
  on(event: 'exit', listener: (code: unknown) => void): void;
}

/** Injected by Headlamp into the plugin bundle scope; absent outside AKS Desktop. */
declare const pluginRunCommand:
  | ((command: string, args: string[], options: Record<string, never>) => RunningCommand)
  | undefined;

export class CliCommandError extends Error {
  readonly code: CliErrorCode;

  constructor(code: CliErrorCode) {
    super(`aks-devctl command failed: ${code}`);
    this.name = 'CliCommandError';
    this.code = code;
  }
}

/** The command's `result` event. The typed wrappers in `commands.ts` check its values. */
export interface CliResult {
  readonly level: 'info' | 'warn';
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Runs `aks-devctl <argv>` and resolves with its result event. The exit code and an `error` event
 * decide the failure code (`outcome`).
 */
export function runCli(argv: readonly string[]): Promise<CliResult> {
  return new Promise<CliResult>((resolve, reject) => {
    if (typeof pluginRunCommand !== 'function') {
      reject(new CliCommandError('unavailable'));
      return;
    }
    let command: RunningCommand;
    try {
      // Headlamp checks its preconditions and throws before it sends the request, so a
      // synchronous throw means that no process was started.
      command = pluginRunCommand(CLI_COMMAND, [...argv], {});
    } catch {
      reject(new CliCommandError('unavailable'));
      return;
    }

    let settled = false;
    let pending = '';
    let sawStdout = false;
    let errorSeen = false;
    let result: CliResult | null = null;

    // A line that is not a JSON object is ignored, like any phase other than `result` and `error`.
    const read = (line: string): void => {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(event)) return;
      const { phase, level, data } = event;
      if (level === 'error' || phase === 'error') {
        errorSeen = true;
      } else if (phase === 'result' && (level === 'info' || level === 'warn')) {
        result = Object.freeze({ level, data: Object.freeze(isRecord(data) ? data : {}) });
      }
    };

    const outcome = (code: unknown): CliResult | CliCommandError => {
      if (code !== null && !Number.isInteger(code)) return new CliCommandError('exit');
      read(pending);
      if (typeof code === 'number' && code < 0) {
        if (sawStdout) return new CliCommandError('exit');
        return new CliCommandError(code === -2 || code === -3 ? 'denied' : 'unavailable');
      }
      if (errorSeen) return new CliCommandError('failed');
      if (code !== 0) return new CliCommandError('exit');
      return result ?? new CliCommandError('missing-terminal');
    };

    const settle = (value: CliResult | CliCommandError): void => {
      if (settled) return;
      settled = true;
      pending = '';
      if (value instanceof CliCommandError) {
        reject(value);
      } else {
        resolve(value);
      }
    };

    try {
      command.stdout.on('data', chunk => {
        if (settled || typeof chunk !== 'string' || chunk === '') return;
        sawStdout = true;
        // Only the unterminated tail is kept, so a long line is never re-split.
        let start = 0;
        let newline = chunk.indexOf('\n');
        while (newline !== -1) {
          read(pending + chunk.slice(start, newline));
          pending = '';
          start = newline + 1;
          newline = chunk.indexOf('\n', start);
        }
        pending += chunk.slice(start);
      });
      command.on('exit', code => {
        if (!settled) settle(outcome(code));
      });
    } catch {
      // The request was sent but its exit event can no longer be observed.
      settle(new CliCommandError('exit'));
    }
  });
}
