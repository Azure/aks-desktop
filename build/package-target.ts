#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Validates a requested desktop package target, stages its verified tools and product metadata,
 * and delegates the final application build to the installed Headlamp source package.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runTimedStep } from './build-timing';

const { resolveInstalledHeadlampPaths } = require(
  '../packages/headlamp-source/src/lib/paths.ts'
);

const ROOT_DIR = path.dirname(__dirname);
const { npmInvocation: resolveNpmInvocation, spawnSync } = require(
  '../packages/headlamp-source/src/lib/npm-command.ts'
);
const BUILD_MANIFEST = '.aks-desktop/product-manifest.json';

interface PackageTarget {
  platform: NodeJS.Platform;
  arch: string;
}

const PACKAGE_ARGS: Record<string, string[]> = {
  'linux:x64': ['--linux', '--x64'],
  'linux:arm64': ['--linux', 'AppImage', 'tar.gz', '--arm64'],
  'darwin:x64': ['--mac', 'dmg', '--x64'],
  'darwin:arm64': ['--mac', 'dmg', '--arm64'],
  'win32:x64': ['--win', '--x64'],
  'win32:arm64': ['--win', '--arm64'],
};

/** Maps a supported package target to its Electron Builder arguments. */
export function packageArguments(platform: NodeJS.Platform, arch: string): string[] {
  const args = PACKAGE_ARGS[`${platform}:${arch}`];
  if (!args) {
    throw new Error(`Unsupported package target: ${platform}/${arch}`);
  }
  return [...args];
}

/** Rejects package targets that cannot execute their required tools on the current host. */
export function validatePackageHost(
  target: PackageTarget,
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch
): void {
  if (target.platform !== hostPlatform) {
    throw new Error(`Cannot package ${target.platform}/${target.arch} from ${hostPlatform}/${hostArch}`);
  }
  if (target.platform !== 'win32' && target.arch !== hostArch) {
    throw new Error(
      `${target.platform} ${target.arch} packages require a native ${target.arch} build host`
    );
  }
}

/** Returns whether packaging needs dependencies reinstalled for another CPU architecture. */
export function requiresTargetDependencyInstall(
  target: PackageTarget,
  hostArch: string = process.arch
): boolean {
  return target.arch !== hostArch;
}

/** Returns the platform-specific npm executable used by child build steps. */
export function npmExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

/** Resolves npm through its JavaScript CLI when called from an npm lifecycle. */
export function npmInvocation(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  nodeExecutable = process.execPath
): { command: string; args: string[] } {
  return resolveNpmInvocation(args, platform, env, nodeExecutable);
}

/** Builds the environment used by target-specific package steps. */
export function packageEnvironment(
  target: PackageTarget,
  rootDir = ROOT_DIR,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...env,
    GOARCH: target.arch === 'x64' ? 'amd64' : target.arch,
    HEADLAMP_BUILD_MANIFEST: BUILD_MANIFEST,
    HEADLAMP_REUSE_PLUGIN_DEPENDENCIES: 'aks-desktop,plugin-catalog',
    npm_config_arch: target.arch,
    npm_config_platform: target.platform,
    npm_config_target_arch: target.arch,
    ...(target.platform === 'darwin' && !env.CUSTOM_DMGBUILD_PATH
      ? { CUSTOM_DMGBUILD_PATH: path.join(rootDir, 'build', 'dmgbuild-managed-mac.cjs') }
      : {}),
  };
}

/** Runs one npm build step and surfaces spawn or non-zero exit failures. */
function runNpm(args: string[], cwd: string, env = process.env): void {
  const invocation = npmInvocation(args, process.platform, env);
  const result = spawnSync(invocation.command, invocation.args, { cwd, env, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

/** Stages the upstream backend under the filename required by Windows packaging. */
export function stageBackendExecutable(sourceDir: string, platform: NodeJS.Platform): void {
  if (platform === 'win32') {
    const backend = path.join(sourceDir, 'backend');
    fs.copyFileSync(path.join(backend, 'headlamp-server'), path.join(backend, 'headlamp-server.exe'));
  }
}

/**
 * Stages product inputs, builds one package target, and reports its output directory.
 * @param target - Platform and architecture to package.
 * @param rootDir - Consumer project root.
 * @param runStep - Runs a build step; replaceable for orchestration tests.
 */
export function packageTarget(
  target: PackageTarget,
  rootDir = ROOT_DIR,
  runStep = runNpm
): void {
  validatePackageHost(target);

  const { sourceDir, appDir, distDir } = resolveInstalledHeadlampPaths(rootDir);
  const targetArgs = [
    `--platform=${target.platform}`,
    `--arch=${target.arch}`,
  ];
  const buildEnv = packageEnvironment(target, rootDir);
  const targetRecord = path.join(distDir, '.package-target.json');
  fs.rmSync(targetRecord, { force: true });

  runTimedStep(`package ${target.platform}/${target.arch}`, () => {
    if (requiresTargetDependencyInstall(target)) {
      runTimedStep('install target dependencies', () =>
        runStep(['run', 'headlamp:install'], rootDir, buildEnv)
      );
    }
    runTimedStep('stage backend executable', () => stageBackendExecutable(sourceDir, target.platform));
    runTimedStep('stage external tools', () =>
      runStep(['run', 'headlamp:tools', '--', ...targetArgs], rootDir)
    );
    runTimedStep('generate product manifest', () =>
      runStep(['run', 'headlamp:manifest'], rootDir)
    );
    runTimedStep('install release plugins', () =>
      runStep(['run', 'plugin:install-releases'], rootDir, buildEnv)
    );
    runTimedStep('distribute translations', () =>
      runStep(['run', 'headlamp:translations'], rootDir)
    );
    runTimedStep('bundle plugins', () =>
      runStep(['run', 'plugin:setup'], rootDir, buildEnv)
    );
    runTimedStep('generate frontend environment', () =>
      runStep(['run', 'headlamp:frontend-env'], rootDir)
    );
    runTimedStep('build frontend', () =>
      runStep(['run', 'frontend:build'], sourceDir, buildEnv)
    );
    runTimedStep('package application', () =>
      runStep(
        ['run', 'package', '--', ...packageArguments(target.platform, target.arch)],
        appDir,
        buildEnv
      )
    );
    fs.writeFileSync(targetRecord, `${JSON.stringify(target)}\n`);
    console.log(
      `\nBuild complete (${target.platform}/${target.arch}).\nOutput directory: ${path.resolve(distDir)}`
    );
  });
}

/** Reads a `--name=value` option from the package-target command line. */
function readOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

if (require.main === module) {
  const platform = readOption('platform') as NodeJS.Platform | undefined;
  const arch = readOption('arch');
  if (!platform || !arch) {
    throw new Error('Usage: package-target.ts --platform=<platform> --arch=<arch>');
  }
  packageTarget({ platform, arch });
}