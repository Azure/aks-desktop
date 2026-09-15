// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const DEBUG_LOGS = process.env.NODE_ENV === 'development' || process.env.DEBUG_AZ_CLI === 'true';

/** Debug logger gated behind NODE_ENV=development or DEBUG_AZ_CLI=true. */
export const debugLog = (...args: any[]) => {
  if (DEBUG_LOGS) {
    console.debug(...args);
  }
};

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a GUID, used to guard subscription IDs in KQL queries. */
export function isValidGuid(value: string): boolean {
  return GUID_PATTERN.test(value);
}

/** Extracts a human-readable message from an unknown thrown value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
