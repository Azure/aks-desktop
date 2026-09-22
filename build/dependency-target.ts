// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';

export interface DependencyTarget {
  platform: NodeJS.Platform;
  arch: string;
}

const DEPENDENCY_TARGET_RECORD = path.join(
  'node_modules',
  '.cache',
  'aks-desktop',
  'headlamp-desktop-target.json'
);
const DEPENDENCY_TARGET_VERSION = 1;

function dependencyLockIdentity(rootDir: string): string | undefined {
  const packageRoot = path.join(
    rootDir,
    'node_modules',
    '@headlamp-k8s',
    'headlamp-source',
    'source'
  );
  const lockfiles = [
    path.join(packageRoot, 'frontend', 'package-lock.json'),
    path.join(packageRoot, 'app', 'package-lock.json'),
  ];
  if (lockfiles.some(lockfile => !fs.existsSync(lockfile))) return undefined;

  const hash = createHash('sha256');
  for (const lockfile of lockfiles) {
    hash.update(path.relative(packageRoot, lockfile));
    hash.update('\0');
    hash.update(fs.readFileSync(lockfile));
  }
  return hash.digest('hex');
}

/** Resolves the dependency target selected by npm or the current host. */
export function dependencyTargetFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch
): DependencyTarget {
  return {
    platform: (env.npm_config_platform as NodeJS.Platform | undefined) ?? hostPlatform,
    arch: env.npm_config_arch ?? env.npm_config_target_arch ?? hostArch,
  };
}

/** Records the architecture represented by the installed Headlamp dependencies. */
export function writeDependencyTarget(
  rootDir: string,
  target: DependencyTarget = dependencyTargetFromEnvironment()
): void {
  const record = path.join(rootDir, DEPENDENCY_TARGET_RECORD);
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(
    record,
    `${JSON.stringify({
      ...target,
      version: DEPENDENCY_TARGET_VERSION,
      lockIdentity: dependencyLockIdentity(rootDir),
    })}\n`
  );
}

/** Checks whether installed Headlamp dependencies match a package target. */
export function dependencyTargetMatches(rootDir: string, target: DependencyTarget): boolean {
  try {
    const record = path.join(rootDir, DEPENDENCY_TARGET_RECORD);
    const installed = JSON.parse(fs.readFileSync(record, 'utf8'));
    return (
      installed.version === DEPENDENCY_TARGET_VERSION &&
      installed.platform === target.platform &&
      installed.arch === target.arch &&
      installed.lockIdentity === dependencyLockIdentity(rootDir)
    );
  } catch {
    return false;
  }
}
