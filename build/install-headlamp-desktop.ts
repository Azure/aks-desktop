#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as path from 'path';
import { runTimedStep } from './build-timing';

const { npmInvocation, spawnSync } = require(
  '../packages/headlamp-source/src/lib/npm-command.ts'
);
const { resolveInstalledHeadlampPaths } = require(
  '../packages/headlamp-source/src/lib/paths.ts'
);

const ROOT_DIR = path.dirname(__dirname);
const CLEAN_INSTALL_ARGS = ['ci', '--prefer-offline', '--no-audit', '--no-fund'] as const;
const PRODUCTION_INSTALL_ARGS = [...CLEAN_INSTALL_ARGS, '--omit=dev'] as const;

export const HEADLAMP_DESKTOP_INSTALL_STEPS = [
  {
    name: 'install Headlamp frontend dependencies',
    relativeDirectory: 'frontend',
    args: PRODUCTION_INSTALL_ARGS,
  },
  {
    name: 'build Headlamp backend',
    relativeDirectory: '.',
    args: ['run', 'backend:build'],
  },
  {
    name: 'install Headlamp app dependencies',
    relativeDirectory: 'app',
    args: CLEAN_INSTALL_ARGS,
  },
] as const;

/** Runs npm in one Headlamp source directory and propagates failures. */
function runNpm(args: readonly string[], cwd: string): void {
  const invocation = npmInvocation([...args], process.platform, process.env, process.execPath);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

/** Installs only the Headlamp dependencies needed to build the desktop application. */
export function installHeadlampDesktopDependencies(
  sourceDir: string,
  runStep: (args: readonly string[], cwd: string) => void = runNpm
): void {
  runTimedStep('install Headlamp desktop dependencies', () => {
    for (const step of HEADLAMP_DESKTOP_INSTALL_STEPS) {
      runTimedStep(step.name, () =>
        runStep(step.args, path.resolve(sourceDir, step.relativeDirectory))
      );
    }
  });
}

if (require.main === module) {
  const { sourceDir } = resolveInstalledHeadlampPaths(ROOT_DIR);
  installHeadlampDesktopDependencies(sourceDir);
}