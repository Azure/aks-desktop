// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Opens a URL in a new browser tab/window.
 *
 * Only `http://` and `https://` protocols are allowed for security.
 * Returns silently if the URL is empty or uses a disallowed protocol.
 *
 * Note: Uses window.open(). A future iteration should use Electron's
 * shell.openExternal via desktopApi IPC for native browser integration.
 */
export function openExternalUrl(url: string): void {
  if (!url) return;
  let normalizedUrl: string;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    normalizedUrl = parsed.href;
  } catch {
    return; // Invalid URL
  }

  window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
}
