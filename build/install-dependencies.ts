#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as path from 'path';
import { runTimedStep } from './build-timing';

const { npmInvocation, spawnSync } = require(
  '../packages/headlamp-source/src/lib/npm-command.ts'
);
const { reusePluginDependencies, writePluginDependencyMarker } = require(
  '../packages/headlamp-source/src/lib/bundle-plugins.ts'
);

const ROOT_DIR = path.dirname(__dirname);

export const DEPENDENCY_INSTALL_STEPS = [
  { name: 'install Headlamp dependencies', script: 'headlamp:install' },
  {
    name: 'install AKS plugin dependencies',
    script: 'plugin:install',
    pluginDirectory: 'plugins/aks-desktop',
  },
  {
    name: 'install AKS theme dependencies',
    script: 'theme:install',
    pluginDirectory: 'plugins/aks-desktop-theme',
  },
  {
    name: 'install plugin catalog dependencies',
    script: 'plugin-catalog:install',
    pluginDirectory: 'plugins/plugin-catalog',
  },
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

/** Installs each dependency group, reusing explicitly selected, verified plugin trees. */
export function installDependencies(
  rootDir = ROOT_DIR,
  runScript: (script: string, rootDir: string) => void = runNpmScript,
  writeMarker: (pluginDir: string) => void = writePluginDependencyMarker,
  env: NodeJS.ProcessEnv = process.env
): void {
  runTimedStep('install all dependencies', () => {
    for (const step of DEPENDENCY_INSTALL_STEPS) {
      if (step.script === 'headlamp:install' && env.HEADLAMP_DEFER_DESKTOP_INSTALL === 'true') {
        console.log('Deferring Headlamp installation until installed-dependency cache restoration.');
        continue;
      }
      runTimedStep(step.name, () => {
        if (
          'pluginDirectory' in step &&
          reusePluginDependencies(
            path.join(rootDir, step.pluginDirectory),
            path.basename(step.pluginDirectory),
            env
          )
        ) {
          console.log(`Reusing verified dependencies: ${step.pluginDirectory}`);
          return;
        }
        runScript(step.script, rootDir);
        if ('pluginDirectory' in step) {
          writeMarker(path.join(rootDir, step.pluginDirectory));
        }
      });
    }
  });
}

if (require.main === module) {
  installDependencies();
}