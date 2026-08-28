#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawnSync } from 'child_process';
import * as path from 'path';

const { resolveInstalledHeadlampPaths } = require(
  '../packages/headlamp-source/scripts/paths.ts'
);

const ROOT_DIR = path.dirname(__dirname);
const BUILD_MANIFEST = '.aks-desktop/product-manifest.json';

interface PackageTarget {
  platform: NodeJS.Platform;
  arch: string;
}

const PACKAGE_ARGS: Record<string, string[]> = {
  'linux:x64': ['--linux', '--x64'],
  'linux:arm64': ['--linux', 'AppImage', 'tar.gz', '--arm64'],
  'darwin:x64': ['--mac', '--x64'],
  'darwin:arm64': ['--mac', '--arm64'],
  'win32:x64': ['--win', '--x64'],
  'win32:arm64': ['--win', '--arm64'],
};

export function packageArguments(platform: NodeJS.Platform, arch: string): string[] {
  const args = PACKAGE_ARGS[`${platform}:${arch}`];
  if (!args) {
    throw new Error(`Unsupported package target: ${platform}/${arch}`);
  }
  return [...args];
}

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

export function npmExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpm(args: string[], cwd: string, env = process.env): void {
  const result = spawnSync(npmExecutable(), args, { cwd, env, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

export function packageTarget(
  target: PackageTarget,
  rootDir = ROOT_DIR
): void {
  validatePackageHost(target);

  const { sourceDir, appDir } = resolveInstalledHeadlampPaths(rootDir);
  const targetArgs = [
    `--platform=${target.platform}`,
    `--arch=${target.arch}`,
  ];
  const buildEnv = {
    ...process.env,
    GOARCH: target.arch === 'x64' ? 'amd64' : target.arch,
    HEADLAMP_BUILD_MANIFEST: BUILD_MANIFEST,
    npm_config_arch: target.arch,
    npm_config_platform: target.platform,
    npm_config_target_arch: target.arch,
  };

  runNpm(['run', 'headlamp:install'], rootDir, buildEnv);
  runNpm(['run', 'headlamp:tools', '--', ...targetArgs], rootDir);
  runNpm(['run', 'headlamp:translations'], rootDir);
  runNpm(['run', 'plugin:setup'], rootDir);
  runNpm(['run', 'headlamp:manifest'], rootDir);
  runNpm(['run', 'headlamp:frontend-env'], rootDir);
  runNpm(['run', 'app:build'], sourceDir, buildEnv);
  runNpm(['run', 'package', '--', ...packageArguments(target.platform, target.arch)], appDir, buildEnv);
}

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
