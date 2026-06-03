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

/**
 * Fetch host info over IPC. Returns `undefined` when the bridge is
 * absent (web mode) or when the IPC call fails. Used by TelemetryBoot
 * to populate the `headlamp.session-start` event.
 */
export async function getAppInfo(): Promise<AppInfo | undefined> {
  const desktopApi = (window as unknown as { desktopApi?: DesktopApi }).desktopApi;
  if (!desktopApi?.getAppInfo) return undefined;
  try {
    return await desktopApi.getAppInfo();
  } catch {
    return undefined;
  }
}
