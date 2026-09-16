// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

type Run = (command: string, args: string[]) => string;
const MACH_O = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

/** Checks the packaged payload, not a build-target marker or wrapper checksum. */
export function verifyMacBundleArchitecture(
  appDirectory: string,
  targetArch: string,
  run: Run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30000 })
): number {
  if (targetArch !== 'arm64' && targetArch !== 'x64') {
    throw new Error(`Unsupported macOS architecture: ${targetArch}`);
  }
  const machine = targetArch === 'x64' ? 'x86_64' : 'arm64';
  const root = fs.realpathSync(appDirectory);
  function confined(file: string): string {
    const resolved = fs.realpathSync(file);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Packaged link escapes application: ${file}`);
    }
    return resolved;
  }

  const python = path.join(root, 'Contents', 'Resources', 'external-tools', 'az-cli', 'darwin', 'bin', 'python3');
  confined(python);
  // Isolated mode avoids ambient Python paths; -S avoids executing site hooks.
  const actual = run(python, ['-I', '-S', '-c', 'import platform; print(platform.machine())']).trim();
  if (actual !== machine) {
    throw new Error(`Bundled Python architecture ${actual} does not match ${machine}`);
  }

  const visited = new Set<string>();
  let checked = 0;
  function visit(file: string): void {
    const resolved = confined(file);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(resolved)) visit(path.join(resolved, entry));
      return;
    }
    if (!stat.isFile() || stat.size < 4) return;
    const descriptor = fs.openSync(resolved, 'r');
    const magic = Buffer.alloc(4);
    try {
      fs.readSync(descriptor, magic, 0, 4, 0);
    } finally {
      fs.closeSync(descriptor);
    }
    if (!MACH_O.has(magic.toString('hex'))) return;
    try {
      // lipo understands both thin and universal binaries, including .so files
      // and dylibs without executable permission bits. No filename heuristics.
      run('/usr/bin/lipo', ['-verify_arch', machine, resolved]);
    } catch (error) {
      throw new Error(`Packaged Mach-O ${path.relative(root, resolved)} lacks ${machine}: ${String(error)}`);
    }
    checked++;
  }
  visit(root);
  if (checked === 0) throw new Error('No Mach-O payload found in packaged application');
  return checked;
}
