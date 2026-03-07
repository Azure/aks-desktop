// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Escapes a string value for safe embedding in a YAML double-quoted scalar.
 * Handles backslashes, double quotes, newlines, tabs, null bytes, and
 * remaining C0 control characters (U+0001–U+0008, U+000B, U+000C,
 * U+000E–U+001F) plus DEL (U+007F).
 */
export function escapeYamlValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\0/g, '\\0')
    .replace(
      /[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g,
      ch => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`
    );
}
