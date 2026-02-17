// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { runCommand } from '@kinvolk/headlamp-plugin/lib';

// Declared with `string` for the command parameter because the runtime global
// accepts any command, while the library type restricts it to a string-literal union.
declare const pluginRunCommand: (
  command: string,
  args: string[],
  options: Record<string, unknown>
) => ReturnType<typeof runCommand>;

/**
 * Executes a shell command via Headlamp's pluginRunCommand bridge.
 *
 * **Important**: This function always resolves — it never rejects.
 * Errors are reported in the `stderr` field of the resolved value.
 * Callers should check `stderr` to detect failures rather than
 * wrapping calls in try/catch.
 *
 * @param command - The executable to run (e.g. the resolved `az` path).
 * @param args - Command-line arguments.
 * @returns Always resolves with `{ stdout, stderr }`. On failure, `stdout`
 *          is empty and `stderr` contains the error description.
 */
export function runCommandAsync(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise(resolve => {
    try {
      if (typeof pluginRunCommand === 'undefined') {
        resolve({
          stdout: '',
          stderr: 'pluginRunCommand is not available.',
        });
        return;
      }

      const cmd = pluginRunCommand(command, args, {});

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const done = (result: { stdout: string; stderr: string }) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      cmd.stdout.on('data', (data: string) => (stdout += data));
      cmd.stderr.on('data', (data: string) => (stderr += data));

      cmd.on('exit', (code: number) => {
        if (code !== 0 && !stderr) {
          stderr = `Command exited with code ${code}`;
        }
        done({ stdout, stderr });
      });
      // Headlamp types the error callback param as `number`, but Node's
      // child_process emits an Error object. Cast to unknown to handle both.
      cmd.on('error', (errOrCode: number) => {
        const value: unknown = errOrCode;
        const msg = value instanceof Error ? value.message : String(value);
        done({ stdout: '', stderr: `Command execution error: ${msg}` });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      resolve({ stdout: '', stderr: `Failed to execute command: ${message}` });
    }
  });
}
