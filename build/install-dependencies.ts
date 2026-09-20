#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as path from 'path';
import { runTimedStep } from './build-timing';

const { npmInvocation, spawnSync } = require(
  '../packages/headlamp-source/src/lib/npm-command.ts'
);

const ROOT_DIR = path.dirname(__dirname);

export const DEPENDENCY_INSTALL_STEPS = [
  { name: 'install Headlamp dependencies', script: 'headlamp:install' },
  { name: 'install AKS plugin dependencies', script: 'plugin:install' },
  { name: 'install AI Assistant dependencies', script: 'ai-assistant:install' },
  { name: 'install plugin catalog dependencies', script: 'plugin-catalog:install' },
] as const;

/** Runs a root npm script and propagates process launch and exit failures. */
function runNpmScript(script: string, rootDir: string): void {
  const invocation = npmInvocation(['run', script], process.platform, process.env, process.execPath);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm run ${script} failed with exit code ${result.status}`);
  }
}

/** Installs each dependency group once with phase-level timing. */
export function installDependencies(
  rootDir = ROOT_DIR,
  runScript: (script: string, rootDir: string) => void = runNpmScript
): void {
  runTimedStep('install all dependencies', () => {
    for (const step of DEPENDENCY_INSTALL_STEPS) {
      runTimedStep(step.name, () => runScript(step.script, rootDir));
    }
  });
}

if (require.main === module) {
  installDependencies();
}