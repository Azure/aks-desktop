// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DesktopApi {
  getInstallId?: () => Promise<string>;
}

/**
 * Fetch the per-install UUID over the Electron preload bridge. Returns
 * `undefined` on web mode, when the bridge is absent, when the IPC fails,
 * or when the returned value doesn't match the UUID shape. Telemetry
 * initialization treats `undefined` as "do not initialize" — we never
 * fall back to a session ID or device-derived value.
 */
export async function getInstallId(): Promise<string | undefined> {
  const desktopApi = (window as { desktopApi?: DesktopApi }).desktopApi;
  if (!desktopApi?.getInstallId) return undefined;
  try {
    const id = await desktopApi.getInstallId();
    return typeof id === 'string' && UUID_RE.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
