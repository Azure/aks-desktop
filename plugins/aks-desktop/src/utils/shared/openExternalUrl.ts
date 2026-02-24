// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Opens a URL in the user's default browser via Electron shell if available,
 * falling back to window.open().
 *
 * Only `http://` and `https://` protocols are allowed for security.
 * Returns silently if the URL is empty or uses a disallowed protocol.
 */
export function openExternalUrl(url: string): void {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
  } catch {
    return; // Invalid URL
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = window.require?.('electron');
    if (electron?.shell?.openExternal) {
      electron.shell.openExternal(url);
      return;
    }
  } catch {
    // Not running in Electron — fall through to window.open
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
