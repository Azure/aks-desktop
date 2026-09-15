// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shared resolution of the build target (platform/arch) so the plugin setup and
 * the post-build verification agree on which architecture is being staged.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Records which platform/arch was staged so later build steps can verify it. */
const STAGED_TARGET_FILE = path.join('headlamp', 'app', 'resources', '.build-target.json');

export interface StagedTarget {
  platform: string;
  arch: string;
}

export function parseTargetArgs(argv: string[]): { platform?: string; arch?: string } {
  const read = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const match = argv.find(argument => argument.startsWith(prefix));
    return match?.slice(prefix.length);
  };
  return { platform: read('platform'), arch: read('arch') };
}

// electron-builder cross-builds are driven by these npm config vars, so they
// describe the package target while process.arch only describes the host.
export function resolveTargetArch(arch?: string): string {
  return arch || process.env.npm_config_target_arch || process.env.npm_config_arch || process.arch;
}

export function writeStagedTarget(rootDir: string, target: StagedTarget): void {
  const markerPath = path.join(rootDir, STAGED_TARGET_FILE);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify(target, null, 2)}\n`);
}

export function readStagedTarget(rootDir: string): StagedTarget | undefined {
  const markerPath = path.join(rootDir, STAGED_TARGET_FILE);
  if (!fs.existsSync(markerPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as StagedTarget;
  } catch {
    return undefined;
  }
}
