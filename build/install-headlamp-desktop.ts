#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'path';
import { runTimedStep } from './build-timing';
import {
  clearDependencyTarget,
  dependencyTargetFromEnvironment,
  writeDependencyTarget,
} from './dependency-target';

const { npmInvocation, spawnSync } = require(
  '../packages/headlamp-source/src/lib/npm-command.ts'
);
const { resolveInstalledHeadlampPaths, resolveWithin } = require(
  '../packages/headlamp-source/src/lib/paths.ts'
);
const { reusePluginDependencies, writePluginDependencyMarker } = require(
  '../packages/headlamp-source/src/lib/bundle-plugins.ts'
);

const ROOT_DIR = path.dirname(__dirname);
const CLEAN_INSTALL_ARGS = ['ci', '--prefer-offline', '--no-audit', '--no-fund'] as const;
const PRODUCTION_INSTALL_ARGS = [...CLEAN_INSTALL_ARGS, '--omit=dev'] as const;
const DEPENDENCY_CONTEXT = '.aks-desktop-headlamp-context';

interface InstallHeadlampDesktopOptions {
  skipBackendBuild?: boolean;
  skipFrontendInstall?: boolean;
  rootDir?: string;
  reuseDependencies?: boolean;
  env?: NodeJS.ProcessEnv;
}

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

function readOptionalFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function activeNpmVersion(env: NodeJS.ProcessEnv): string {
  if (!env.npm_execpath) {
    throw new Error('Verified Headlamp dependency caching requires an npm lifecycle.');
  }
  const npm = JSON.parse(fs.readFileSync(
    path.resolve(path.dirname(fs.realpathSync(env.npm_execpath)), '..', 'package.json'),
    'utf8'
  ));
  if (
    npm.name !== 'npm' ||
    typeof npm.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(npm.version)
  ) {
    throw new Error('Cannot identify the npm version used for Headlamp dependencies.');
  }
  return npm.version;
}

function dependencyInputIdentity(
  sourceDir: string,
  rootDir: string,
  step: { relativeDirectory: string; args: readonly string[] },
  env: NodeJS.ProcessEnv
): string {
  const project = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (
    typeof project.headlampSource?.revision !== 'string' ||
    typeof project.headlampPatch?.integrity !== 'string'
  ) {
    throw new Error('Headlamp caching requires a source pin and verified patch integrity.');
  }
  const directory = path.join(sourceDir, step.relativeDirectory);
  const settings = [
    'NODE_ENV', 'npm_config_omit', 'npm_config_include', 'npm_config_production',
    'npm_config_ignore_scripts', 'npm_config_legacy_peer_deps', 'npm_config_install_strategy',
    'npm_config_os', 'npm_config_cpu', 'npm_config_libc', 'npm_config_runtime',
    'npm_config_target', 'npm_config_disturl', 'npm_config_build_from_source', 'npm_config_debug',
    'ELECTRON_SKIP_BINARY_DOWNLOAD', 'ELECTRON_MIRROR',
    'ELECTRON_CUSTOM_VERSION', 'ELECTRON_CUSTOM_DIR', 'ELECTRON_CUSTOM_FILENAME',
    'ELECTRON_OVERRIDE_DIST_PATH',
  ];
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    source: project.headlampSource,
    patch: project.headlampPatch,
    scripts: project.scripts ?? {},
    node: process.version,
    abi: process.versions.modules,
    npm: activeNpmVersion(env),
    target: dependencyTargetFromEnvironment(env),
    image: env.ImageOS ?? null,
    args: step.args,
    settings: settings.map(name => env[name] ?? env[name.toUpperCase()] ?? null),
    configuration: [
      path.join(rootDir, '.npmrc'),
      path.join(sourceDir, '.npmrc'),
      path.join(directory, '.npmrc'),
    ].map(readOptionalFile),
    manifest: fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
    lock: fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'),
  })).digest('hex');
}

function dependenciesMatch(directory: string, name: string, identity: string): boolean {
  return (
    readOptionalFile(path.join(directory, 'node_modules', DEPENDENCY_CONTEXT))?.trim() === identity &&
    reusePluginDependencies(directory, name, { HEADLAMP_REUSE_PLUGIN_DEPENDENCIES: name }) === true
  );
}

/** Resolves cache inputs without depending on unrelated consumer product metadata. */
export function headlampDependencyCacheInputs(
  sourceDir: string,
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): { key: string; paths: string[] } {
  const source: string = resolveWithin(rootDir, path.relative(rootDir, sourceDir), 'Headlamp source');
  const steps = HEADLAMP_DESKTOP_INSTALL_STEPS.filter(step => step.relativeDirectory !== '.');
  return {
    key: createHash('sha256').update(
      steps.map(step => dependencyInputIdentity(source, rootDir, step, env)).join('\n')
    ).digest('hex'),
    paths: steps.map(step =>
      path.relative(rootDir, path.join(source, step.relativeDirectory, 'node_modules'))
        .split(path.sep).join('/')
    ),
  };
}

/** Discards both restored trees without touching source files or other dependency groups. */
export function discardHeadlampDependencyCache(sourceDir: string, rootDir: string): void {
  const source: string = resolveWithin(rootDir, path.relative(rootDir, sourceDir), 'Headlamp source');
  clearDependencyTarget(rootDir);
  for (const step of HEADLAMP_DESKTOP_INSTALL_STEPS) {
    if (step.relativeDirectory === '.') continue;
    fs.rmSync(path.join(source, step.relativeDirectory, 'node_modules'), {
      recursive: true, force: true, maxRetries: 3,
    });
  }
}

/** Refuses to publish incomplete or stale installed-dependency snapshots. */
export function verifyHeadlampDependencyCache(
  sourceDir: string,
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  resolveWithin(rootDir, path.relative(rootDir, sourceDir), 'Headlamp source');
  for (const step of HEADLAMP_DESKTOP_INSTALL_STEPS) {
    if (step.relativeDirectory === '.') continue;
    const identity = dependencyInputIdentity(sourceDir, rootDir, step, env);
    if (!dependenciesMatch(path.join(sourceDir, step.relativeDirectory), step.relativeDirectory, identity)) {
      throw new Error(`Headlamp ${step.relativeDirectory} dependency cache is missing or stale.`);
    }
  }
}

/** Runs npm in one Headlamp source directory and propagates failures. */
function runNpm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const invocation = npmInvocation([...args], process.platform, env, process.execPath);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    env,
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
  runStep: (args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) => void = runNpm,
  options: InstallHeadlampDesktopOptions = {}
): void {
  const env = options.env ?? process.env;
  const skipBackendBuild = options.skipBackendBuild ??
    env.HEADLAMP_SKIP_INSTALL_BACKEND_BUILD === 'true';
  const skipFrontendInstall = options.skipFrontendInstall ??
    env.HEADLAMP_SKIP_INSTALL_FRONTEND === 'true';
  const rootDir = options.rootDir ?? ROOT_DIR;
  if (options.reuseDependencies) {
    resolveWithin(rootDir, path.relative(rootDir, sourceDir), 'Headlamp source');
  }
  if (options.rootDir) clearDependencyTarget(options.rootDir);
  runTimedStep('install Headlamp desktop dependencies', () => {
    for (const step of HEADLAMP_DESKTOP_INSTALL_STEPS) {
      if (skipBackendBuild && step.name === 'build Headlamp backend') {
        continue;
      }
      if (skipFrontendInstall && step.name === 'install Headlamp frontend dependencies') {
        continue;
      }
      runTimedStep(step.name, () => {
        const directory = path.resolve(sourceDir, step.relativeDirectory);
        const cached = options.reuseDependencies && step.relativeDirectory !== '.';
        if (cached) {
          const identity = dependencyInputIdentity(sourceDir, rootDir, step, env);
          if (dependenciesMatch(directory, step.relativeDirectory, identity)) {
            console.log(`Reusing verified Headlamp dependencies: ${step.relativeDirectory}`);
            return;
          }
          console.log(`Installing Headlamp ${step.relativeDirectory}: cache missing or stale.`);
        }
        runStep(step.args, directory, env);
        if (cached) {
          writePluginDependencyMarker(directory);
          fs.writeFileSync(
            path.join(directory, 'node_modules', DEPENDENCY_CONTEXT),
            `${dependencyInputIdentity(sourceDir, rootDir, step, env)}\n`
          );
        }
      });
    }
  });
  if (options.rootDir) {
    writeDependencyTarget(options.rootDir, dependencyTargetFromEnvironment(env));
  }
}

if (require.main === module) {
  const { sourceDir } = resolveInstalledHeadlampPaths(ROOT_DIR);
  if (process.argv.includes('--cache-inputs')) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('Cache inputs require GITHUB_OUTPUT.');
    const policy = process.env.HEADLAMP_CACHE_POLICY;
    if (!policy || !/^[a-f0-9]{64}$/i.test(policy)) {
      throw new Error('Cache inputs require a HEADLAMP_CACHE_POLICY fingerprint.');
    }
    const { key, paths } = headlampDependencyCacheInputs(sourceDir, ROOT_DIR);
    const primaryKey =
      `headlamp-desktop-deps-v1-${process.platform}-${process.arch}-${process.version}-npm-${activeNpmVersion(process.env)}-${policy}-${key}`;
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `key=${primaryKey}\npaths<<HEADLAMP_DEPENDENCIES\n${paths.join('\n')}\nHEADLAMP_DEPENDENCIES\n`
    );
  } else if (process.argv.includes('--discard-cache')) {
    discardHeadlampDependencyCache(sourceDir, ROOT_DIR);
  } else if (process.argv.includes('--verify-cache')) {
    verifyHeadlampDependencyCache(sourceDir, ROOT_DIR);
  } else {
    installHeadlampDesktopDependencies(sourceDir, runNpm, {
      rootDir: ROOT_DIR,
      reuseDependencies: process.env.HEADLAMP_REUSE_DESKTOP_DEPENDENCIES === 'true',
    });
  }
}