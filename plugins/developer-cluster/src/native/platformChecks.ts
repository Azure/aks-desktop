// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The platform checks of the environment step, run only by the plugin. Windows x64 comes from the
// browser's User-Agent Client Hints. WSL 2 comes from the read-only `wsl --status` and `reg query`
// that AKS Desktop grants this plugin; Desktop runs none itself. Installed distributions are not
// inspected: the CLI registers a new WSL 2 instance named after the cluster and never uses one the
// user installed. Nothing is started or installed, and a query that fails or does not exit within
// QUERY_TIMEOUT_MS reports `unknown`.

import type { RunningCommand } from '../cli/runner';
import { HostEnvironment } from '../contract/capability';

/** Injected by Headlamp into the plugin bundle scope; absent outside AKS Desktop. */
declare const pluginRunCommand:
  | ((command: string, args: string[], options: Record<string, never>) => RunningCommand)
  | undefined;

/** The output bound of the host's `inspect` queries. */
const MAX_OUTPUT_CHARS = 64 * 1024;

/**
 * How long a query may run. `wsl --status` can take seconds while WSL starts. Headlamp offers no
 * way to stop a command, so a query that runs longer is left running and its result ignored.
 */
export const QUERY_TIMEOUT_MS = 30_000;

const LXSS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss';
const DEFAULT_VERSION = /^\s*DefaultVersion\s+REG_DWORD\s+0x([12])\s*$/m;

export type WslInspection = Pick<HostEnvironment, 'wsl'>;

interface QueryOutput {
  readonly code: number;
  readonly stdout: string;
}

/** The query did not run or its exit could not be read. */
class QueryUnavailable extends Error {}

function query(tool: string, args: readonly string[]): Promise<QueryOutput> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<QueryOutput>((resolve, reject) => {
    if (typeof pluginRunCommand !== 'function') {
      reject(new QueryUnavailable());
      return;
    }
    let command: RunningCommand;
    try {
      command = pluginRunCommand(tool, [...args], {});
    } catch {
      reject(new QueryUnavailable());
      return;
    }
    timer = setTimeout(() => reject(new QueryUnavailable()), QUERY_TIMEOUT_MS);
    let stdout = '';
    let oversized = false;
    try {
      command.stdout.on('data', chunk => {
        if (typeof chunk !== 'string' || oversized) return;
        stdout += chunk;
        oversized = stdout.length > MAX_OUTPUT_CHARS;
      });
      // A negative code is Headlamp refusing or failing to start the command.
      command.on('exit', code => {
        if (oversized || typeof code !== 'number' || !Number.isInteger(code) || code < 0) {
          reject(new QueryUnavailable());
          return;
        }
        resolve({ code, stdout });
      });
    } catch {
      reject(new QueryUnavailable());
    }
  });
  return result.finally(() => clearTimeout(timer));
}

/** Trimmed non-empty lines, without the NULs and byte-order marks a UTF-16LE decode leaves. */
function outputLines(stdout: string): string[] {
  return stdout
    .replace(/[\u0000\uFEFF\uFFFD]/g, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * WSL is ready when `wsl --status` succeeds and WSL's default version is 2: the CLI's new instance
 * inherits it, and WSL 1 must not be installed silently. As in WSL's GetDefaultVersion and the
 * CLI's `prereq check` (`aks-devctl/src/pkg/drivers/wsl/host_prereq_windows.go`), an absent
 * `DefaultVersion` value means WSL 2; `reg query` exits non-zero when the value is absent.
 */
export async function inspectWsl(): Promise<WslInspection> {
  try {
    const status = await query('wsl', ['--status']);
    if (status.code !== 0) return { wsl: 'manual-setup-required' };
    const defaults = await query('reg', ['query', LXSS_KEY, '/v', 'DefaultVersion']);
    if (defaults.code !== 0) return { wsl: 'ready' };
    const match = DEFAULT_VERSION.exec(outputLines(defaults.stdout).join('\n'));
    if (match === null) return { wsl: 'unknown' };
    return { wsl: match[1] === '2' ? 'ready' : 'manual-setup-required' };
  } catch {
    return { wsl: 'unknown' };
  }
}

interface UserAgentData {
  getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>;
}

/**
 * Whether the browser reports 64-bit Windows on x86 (x64); null when it cannot tell. Chromium
 * reports the architecture as `x86` and the bitness as `64` for x64.
 */
export async function detectWindowsX64(): Promise<boolean | null> {
  const data =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as { userAgentData?: UserAgentData }).userAgentData;
  if (data === undefined || typeof data.getHighEntropyValues !== 'function') return null;
  try {
    const { platform, architecture, bitness } = await data.getHighEntropyValues([
      'platform',
      'architecture',
      'bitness',
    ]);
    // A missing or empty hint means the browser cannot tell, which must not block.
    if (![platform, architecture, bitness].every(v => typeof v === 'string' && v !== '')) {
      return null;
    }
    return platform === 'Windows' && architecture === 'x86' && bitness === '64';
  } catch {
    return null;
  }
}
