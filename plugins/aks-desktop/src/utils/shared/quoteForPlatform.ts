// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Returns the argument string formatted for the current platform's shell.
 * On Windows, the value is wrapped in double quotes because `az` passes
 * arguments through cmd.exe which strips single quotes. On Unix, the value
 * is passed as-is (child_process handles quoting).
 */
export function quoteForPlatform(value: string): string {
  const isWindows = (window as any)?.desktopApi?.platform === 'win32';
  return isWindows ? `"${value.replace(/\n/g, '')}"` : value;
}
