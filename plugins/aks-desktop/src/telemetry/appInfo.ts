// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

export interface AppInfo {
  os: 'win32' | 'darwin' | 'linux';
  osMajor: string;
  arch: 'x64' | 'arm64' | 'ia32';
  electronVersion: string;
}

interface DesktopApi {
  getAppInfo?: () => Promise<AppInfo>;
}

function isAppInfo(value: unknown): value is AppInfo {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.os === 'win32' || v.os === 'darwin' || v.os === 'linux') &&
    typeof v.osMajor === 'string' &&
    (v.arch === 'x64' || v.arch === 'arm64' || v.arch === 'ia32') &&
    typeof v.electronVersion === 'string'
  );
}

/**
 * Fetch host info over the Electron preload bridge. Returns `undefined`
 * when the bridge is absent, when the IPC call fails, or when the
 * returned object doesn't match the expected shape — matching the
 * fail-closed posture in `getInstallId`.
 */
export async function getAppInfo(): Promise<AppInfo | undefined> {
  const desktopApi = (window as { desktopApi?: DesktopApi }).desktopApi;
  if (!desktopApi?.getAppInfo) return undefined;
  try {
    const result = await desktopApi.getAppInfo();
    return isAppInfo(result) ? result : undefined;
  } catch {
    return undefined;
  }
}
