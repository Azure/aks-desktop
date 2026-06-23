// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

export interface AppInfo {
  /** Host OS from `window.desktopApi.platform`; `'unknown'` if absent. */
  os: NodeJS.Platform | 'unknown';
  /**
   * Host arch parsed from `navigator.userAgent`. Returns `'x64' | 'arm64' |
   * 'arm' | 'ia32' | 'unknown'`. On macOS Apple Silicon the legacy UA
   * reports Intel for Chromium site-compat, so this returns `'x64'`
   * there — fine for telemetry bucketing.
   */
  arch: string;
  /** Electron version parsed from UA (e.g. `'31.2.0'`); `'unknown'` outside Electron. */
  electronVersion: string;
}

// window.desktopApi is declared `any` by @kinvolk/headlamp-plugin; cast
// locally rather than redeclaring (would conflict).
interface DesktopApiPlatform {
  platform?: NodeJS.Platform;
}

function getDesktopApiPlatform(): NodeJS.Platform | 'unknown' {
  if (typeof window === 'undefined') return 'unknown';
  const api = (window as { desktopApi?: DesktopApiPlatform }).desktopApi;
  return api?.platform ?? 'unknown';
}

function parseArch(ua: string): string {
  // Linux:   "Linux x86_64", "Linux aarch64", "Linux armv7l"
  // macOS:   "Macintosh; Intel Mac OS X ..." (Intel + Apple Silicon both)
  // Windows: "Win64; x64", "WOW64", "ARM64"
  const m =
    ua.match(/\b(x86_64|aarch64|arm64|armv7l|ARM64|Win64; x64|WOW64)\b/) ??
    ua.match(/Intel Mac OS X/i);
  if (!m) return 'unknown';
  const raw = m[0];
  if (/x86_64|Win64; x64/.test(raw)) return 'x64';
  if (/aarch64|arm64|ARM64/.test(raw)) return 'arm64';
  if (/armv7l/.test(raw)) return 'arm';
  if (/WOW64/.test(raw)) return 'ia32';
  if (/Intel Mac OS X/i.test(raw)) return 'x64';
  return 'unknown';
}

function parseElectronVersion(ua: string): string {
  const m = ua.match(/Electron\/([\d.]+)/);
  return m?.[1] ?? 'unknown';
}

/** Synchronously read host info. Never throws; missing sources → 'unknown'. */
export function getAppInfo(): AppInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return {
    os: getDesktopApiPlatform(),
    arch: parseArch(ua),
    electronVersion: parseElectronVersion(ua),
  };
}
