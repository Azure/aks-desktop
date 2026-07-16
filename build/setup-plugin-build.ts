// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawnSync } from "node:child_process";

interface PluginBuildCommandOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  encoding: "utf8";
  maxBuffer: number;
  stdio: "pipe";
}

interface PluginBuildCommandResult {
  error?: Error;
  signal?: NodeJS.Signals | null;
  status: number | null;
  stderr: string;
  stdout: string;
}

type PluginBuildCommandRunner = (
  command: string,
  args: string[],
  options: PluginBuildCommandOptions
) => PluginBuildCommandResult;

interface PluginBuildOutput {
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

const DEFAULT_OUTPUT: PluginBuildOutput = {
  stderr: (value) => process.stderr.write(value),
  stdout: (value) => process.stdout.write(value),
};

const MAX_PLUGIN_BUILD_OUTPUT_BYTES = 64 * 1024 * 1024;

function redactSensitiveOutput(
  value: string,
  environment: NodeJS.ProcessEnv
): string {
  const connectionString = environment.REACT_APP_APPINSIGHTS_CONNECTION_STRING;
  let redacted = value.replace(
    /(REACT_APP_APPINSIGHTS_CONNECTION_STRING\s*=\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]*)/g,
    '$1"[redacted]"'
  );

  if (connectionString) {
    redacted = redacted.split(connectionString).join("[redacted]");
  }

  return redacted;
}

export function runPluginBuildCommand(
  command: string,
  args: string[],
  pluginDir: string,
  environment: NodeJS.ProcessEnv,
  commandRunner: PluginBuildCommandRunner = spawnSync,
  output: PluginBuildOutput = DEFAULT_OUTPUT
): void {
  const result = commandRunner(command, args, {
    cwd: pluginDir,
    encoding: "utf8",
    env: environment,
    maxBuffer: MAX_PLUGIN_BUILD_OUTPUT_BYTES,
    stdio: "pipe",
  });

  output.stdout(redactSensitiveOutput(result.stdout ?? "", environment));
  output.stderr(redactSensitiveOutput(result.stderr ?? "", environment));

  if (result.error) {
    throw new Error(
      `Plugin command failed to start: ${redactSensitiveOutput(
        result.error.message,
        environment
      )}`
    );
  }
  if (result.signal) {
    throw new Error(`Plugin command terminated by signal ${result.signal}.`);
  }
  if (result.status !== 0) {
    throw new Error(`Plugin command exited with status ${result.status}.`);
  }
}

export function runNpmBuildCommand(
  args: string[],
  pluginDir: string,
  environment: NodeJS.ProcessEnv,
  commandRunner: PluginBuildCommandRunner = spawnSync,
  output: PluginBuildOutput = DEFAULT_OUTPUT
): void {
  const npmExecutable = environment.npm_execpath;
  runPluginBuildCommand(
    npmExecutable ? process.execPath : "npm",
    npmExecutable ? [npmExecutable, ...args] : args,
    pluginDir,
    environment,
    commandRunner,
    output
  );
}

export function installAndBuildPlugin(
  pluginDir: string,
  environment: NodeJS.ProcessEnv,
  commandRunner: PluginBuildCommandRunner = spawnSync,
  output: PluginBuildOutput = DEFAULT_OUTPUT
): void {
  runNpmBuildCommand(
    ["install"],
    pluginDir,
    environment,
    commandRunner,
    output
  );
  runNpmBuildCommand(
    ["run", "build"],
    pluginDir,
    environment,
    commandRunner,
    output
  );
}
