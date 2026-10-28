// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Windows ZIP extraction for bundled tools.
 *
 * Archives are extracted with the in-box bsdtar (`%SystemRoot%\System32\tar.exe`) rather than
 * Windows PowerShell's `Expand-Archive`, which cannot create paths longer than MAX_PATH, can
 * autoload PowerShell 7's incompatible Archive module through an inherited `PSModulePath`, and
 * masks its original failure with errors from its own partial-extraction cleanup. bsdtar is
 * resolved from the system directory, never `PATH`, and by default refuses entries containing
 * `..` and strips drive letters, so entries cannot be written outside the destination.
 */

import * as path from 'path';

/** Longest path, in characters, that non-long-path-aware Windows programs can open. */
export const WINDOWS_MAX_PATH_LENGTH = 259;

const FILE_SYSTEM_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem';

interface Invocation {
  command: string;
  args: string[];
}

/** An archive entry whose extracted path exceeds the Windows MAX_PATH limit. */
export interface WindowsPathLimitViolation {
  fullPath: string;
  length: number;
}

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(candidate => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** Resolves an in-box Windows tool from the system directory rather than `PATH`. */
export function windowsSystemToolPath(tool: string, env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = environmentValue(env, 'SystemRoot');
  if (!systemRoot || !/^[A-Za-z]:[\\/]/.test(systemRoot)) {
    throw new Error(`SystemRoot must be an absolute drive path to locate the Windows ${tool}`);
  }
  return path.win32.join(systemRoot, 'System32', tool);
}

/** Extracts a ZIP with the in-box bsdtar; arguments are passed without a shell. */
export function windowsZipExtraction(
  archivePath: string,
  outputDir: string,
  env: NodeJS.ProcessEnv = process.env
): Invocation {
  return {
    command: windowsSystemToolPath('tar.exe', env),
    args: ['-x', '-f', archivePath, '-C', outputDir],
  };
}

/** Lists ZIP entry names, one per line, with the in-box bsdtar. */
export function windowsZipListing(
  archivePath: string,
  env: NodeJS.ProcessEnv = process.env
): Invocation {
  return {
    command: windowsSystemToolPath('tar.exe', env),
    args: ['-t', '-f', archivePath],
  };
}

/** Reads the machine-wide long-path setting; `reg.exe` exits non-zero when it is unset. */
export function windowsLongPathsQuery(env: NodeJS.ProcessEnv = process.env): Invocation {
  return {
    command: windowsSystemToolPath('reg.exe', env),
    args: ['query', FILE_SYSTEM_KEY, '/v', 'LongPathsEnabled'],
  };
}

/** Returns whether `reg query` output shows a non-zero `LongPathsEnabled` value. */
export function longPathsEnabledFromRegQuery(output: string): boolean {
  const match = /\bLongPathsEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(output);
  return match !== null && parseInt(match[1], 16) !== 0;
}

/** Returns extracted paths that would exceed {@link WINDOWS_MAX_PATH_LENGTH}, longest first. */
export function windowsPathLimitViolations(
  entries: readonly string[],
  outputDir: string
): WindowsPathLimitViolation[] {
  const violations = new Map<string, number>();
  for (const entry of entries) {
    const relative = entry.trim().replace(/[\\/]+$/, '');
    if (!relative) {
      continue;
    }
    const fullPath = path.win32.join(outputDir, relative);
    if (fullPath.length > WINDOWS_MAX_PATH_LENGTH) {
      violations.set(fullPath, fullPath.length);
    }
  }
  return [...violations]
    .map(([fullPath, length]) => ({ fullPath, length }))
    .sort((left, right) => right.length - left.length);
}

/** Explains how to make an archive's paths usable when Windows long paths are disabled. */
export function windowsPathLimitMessage(
  violations: readonly WindowsPathLimitViolation[],
  outputDir: string,
  toolName: string
): string {
  const longest = violations[0];
  const excess = longest.length - WINDOWS_MAX_PATH_LENGTH;
  return [
    `${toolName} cannot be installed at:`,
    `  ${outputDir}`,
    `${violations.length} extracted path(s) would exceed the Windows ${WINDOWS_MAX_PATH_LENGTH + 1}-character limit; ` +
      `the longest is ${longest.length} characters:`,
    `  ${longest.fullPath}`,
    'Windows long paths are disabled, so the bundled Python could not load these files. Either:',
    '  - enable long paths from an administrator PowerShell, then open a new terminal:',
    `      Set-ItemProperty '${FILE_SYSTEM_KEY.replace('HKLM\\', 'HKLM:\\')}' LongPathsEnabled 1`,
    `  - or move the repository to a path at least ${excess} characters shorter (for example C:\\src\\aks-desktop).`,
  ].join('\n');
}
