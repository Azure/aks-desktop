// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runCommand } from '@kinvolk/headlamp-plugin/lib';

declare const pluginRunCommand: typeof runCommand;

function runCommandAsync(
  command: 'az',
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  console.debug('command called:', command, args);
  return new Promise(resolve => {
    try {
      const cmd = pluginRunCommand(command, args, {});
      let stdout = '';
      let stderr = '';

      cmd.stdout.on('data', (data: string) => (stdout += data));
      cmd.stderr.on('data', (data: string) => (stderr += data));

      cmd.on('exit', () => {
        resolve({ stdout, stderr });
      });

      cmd.on('error', (code: number) => {
        resolve({ stdout: '', stderr: `Command execution error (code ${code})` });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      resolve({ stdout: '', stderr: `Failed to execute command: ${errorMessage}` });
    }
  });
}

export async function runCommandWithOutput(
  command: 'az',
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return await runCommandAsync(command, args);
}
