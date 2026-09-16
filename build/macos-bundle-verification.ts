// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

type Run = (command: string, args: string[]) => string;
export interface MacVerificationHost {
  platform: string;
  arch: string;
}

/** A translated verifier cannot establish native execution, even for universal files. */
export function assertNativeMacHost(
  targetArch: string,
  run: Run,
  host: MacVerificationHost = process
): void {
  if (targetArch !== 'arm64' && targetArch !== 'x64') {
    throw new Error(`Unsupported macOS architecture: ${targetArch}`);
  }
  if (host.platform !== 'darwin' || host.arch !== targetArch) {
    throw new Error(
      `macOS ${targetArch} verification requires a matching native macOS host; got ${host.platform}/${host.arch}`
    );
  }
  // -i tolerates the absent key on Intel, but command failures still propagate.
  const translated = run('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated']).trim();
  if (translated !== '' && translated !== '0') {
    throw new Error(`Rosetta/translated execution is not allowed: ${translated}`);
  }
}

const MACH_O = new Set([
  'feedface',
  'cefaedfe',
  'feedfacf',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca',
]);

/** Checks the packaged payload, not a build-target marker or wrapper checksum. */
export function verifyMacBundleArchitecture(
  appDirectory: string,
  targetArch: string,
  run: Run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30000 }),
  host: MacVerificationHost = process
): number {
  assertNativeMacHost(targetArch, run, host);
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

  const plist = confined(path.join(root, 'Contents', 'Info.plist'));
  const executableName = run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    plist,
  ]).trim();
  if (
    !executableName ||
    executableName === '.' ||
    executableName === '..' ||
    /[/\\\\\0]/.test(executableName)
  ) {
    throw new Error(`Invalid CFBundleExecutable: ${executableName}`);
  }
  const minimumSystemVersion = run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :LSMinimumSystemVersion',
    plist,
  ]).trim();
  if (!/^\d+(?:\.\d+){0,2}$/.test(minimumSystemVersion)) {
    throw new Error(`Invalid LSMinimumSystemVersion: ${minimumSystemVersion}`);
  }
  const advertised = minimumSystemVersion.split('.').map(Number);
  const python = path.join(
    root,
    'Contents',
    'Resources',
    'external-tools',
    'az-cli',
    'darwin',
    'bin',
    'python3'
  );
  // Pinned Headlamp app/package.json mac.extraResources copies the backend here.
  const required = [
    path.join(root, 'Contents', 'MacOS', executableName),
    path.join(root, 'Contents', 'Resources', 'headlamp-server'),
    python,
  ];
  const requiredFiles = new Set(
    required.map((file) => {
      const resolved = confined(file);
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || !(stat.mode & 0o111)) {
        throw new Error(`Required payload must be an executable Mach-O file: ${file}`);
      }
      return resolved;
    })
  );

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
      throw new Error(
        `Packaged Mach-O ${path.relative(root, resolved)} lacks ${machine}: ${String(error)}`
      );
    }
    // Audit deployment targets, not the SDK version: a newer build host must
    // not ship a library requiring newer macOS than the app advertises.
    const commands = run('/usr/bin/otool', ['-arch', machine, '-l', resolved]);
    const minimums = commands.split(/(?=Load command \d+)/).flatMap((block) => {
      const field = /\bcmd LC_BUILD_VERSION\b/.test(block)
        ? 'minos'
        : /\bcmd LC_VERSION_MIN_MACOSX\b/.test(block)
        ? 'version'
        : undefined;
      const version =
        field && block.match(new RegExp(`\\b${field}\\s+(\\d+(?:\\.\\d+){0,2})\\b`))?.[1];
      return version ? [version] : [];
    });
    if (!minimums.length) throw new Error(`Missing macOS deployment target: ${resolved}`);
    for (const minimum of minimums) {
      const required = minimum.split('.').map(Number);
      const difference = required.findIndex((value, index) => value !== (advertised[index] || 0));
      if (difference >= 0 && required[difference] > (advertised[difference] || 0)) {
        throw new Error(
          `${path.relative(
            root,
            resolved
          )} requires macOS ${minimum}, above advertised ${minimumSystemVersion}`
        );
      }
    }
    console.log(
      `Mach-O ${path.relative(root, resolved)}: ${machine}, minimum macOS ${minimums.join(
        ', '
      )}, advertised ${minimumSystemVersion}`
    );
    requiredFiles.delete(resolved);
    checked++;
  }
  visit(root);
  if (requiredFiles.size) {
    throw new Error(`Required payload must be Mach-O: ${[...requiredFiles].join(', ')}`);
  }
  // Execute only after the complete static audit, including link confinement.
  // -I ignores PYTHONDONTWRITEBYTECODE, so explicitly forbid bytecode writes.
  const actual = run(python, [
    '-I',
    '-B',
    '-S',
    '-c',
    'import platform; print(platform.machine())',
  ]).trim();
  if (actual !== machine) {
    throw new Error(`Bundled Python architecture ${actual} does not match ${machine}`);
  }
  return checked;
}
