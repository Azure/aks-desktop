// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shares the package target between setup and post-build verification.
 *
 * `setup-plugins.ts` and `verify-bundled-tools.ts` run as separate processes,
 * so npm's target-architecture variables are not guaranteed to reach the
 * verifier. The marker lets it inspect the output directory built most
 * recently. This module also removes retired artifacts from incremental build
 * trees before those trees are packaged again.
 */

import * as fs from 'fs';
import * as path from 'path';

const BUILD_TARGET_FILE = path.join('headlamp', 'app', 'resources', '.build-target.json');

/** Platform and architecture selected by the packaging command. */
export interface BuildTarget {
  /** Node platform name used by electron-builder. */
  platform: string;
  /** Package architecture, which may differ from the build host. */
  arch: string;
}

/** @returns Explicit electron-builder platform and architecture arguments. */
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

/** Records the package target for a later post-build verification process. */
export function writeBuildTarget(rootDir: string, target: BuildTarget): void {
  const markerPath = path.join(rootDir, BUILD_TARGET_FILE);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify(target, null, 2)}\n`);
}

/** @returns The most recently recorded package target, if the marker is valid. */
export function readBuildTarget(rootDir: string): BuildTarget | undefined {
  const markerPath = path.join(rootDir, BUILD_TARGET_FILE);
  if (!fs.existsSync(markerPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as BuildTarget;
  } catch {
    return undefined;
  }
}

/**
 * Removes AKS MCP files left by a v0.10.1 incremental build.
 *
 * Keep this cleanup while build trees and caches from v0.10.1 remain supported;
 * otherwise a rebuild could package a binary that is no longer downloaded.
 */
export function removeRetiredAksMcpArtifacts(rootDir: string): void {
  const resourcesDir = path.join(rootDir, 'headlamp', 'app', 'resources');
  for (const retiredPath of [
    path.join(resourcesDir, 'external-tools', 'bin', 'aks-mcp'),
    path.join(resourcesDir, 'external-tools', 'bin', 'aks-mcp.exe'),
    path.join(resourcesDir, '.aks-mcp-target.json'),
  ]) {
    fs.rmSync(retiredPath, { force: true });
  }
}