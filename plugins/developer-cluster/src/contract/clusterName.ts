// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The cluster name: 1-63 characters of [a-z0-9-], beginning and ending alphanumeric.

export const CLUSTER_NAME_MAX_LENGTH = 63;

/** The pre-filled default name; users can change it. */
export const DEFAULT_CLUSTER_NAME = 'dev-cluster';

const CLUSTER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A broken cluster name rule: `required` for an empty name, `too-long` above 63 characters,
 * `characters` for a character outside [a-z0-9-], and `boundary` for a hyphen at either end.
 */
export type ClusterNameProblem = 'required' | 'too-long' | 'characters' | 'boundary';

/**
 * Whether a value is a valid cluster name.
 *
 * @param value - The value to check.
 * @returns True for 1-63 characters of [a-z0-9-], beginning and ending alphanumeric.
 */
export function isClusterName(value: unknown): value is string {
  return typeof value === 'string' && CLUSTER_NAME.test(value);
}

/**
 * Returns the first rule the value breaks, or null when the name is valid.
 *
 * @param value - The cluster name the user entered.
 * @returns The first broken rule, in the order required, too-long, characters, boundary; or null.
 */
export function clusterNameProblem(value: string): ClusterNameProblem | null {
  if (value.length === 0) return 'required';
  if (value.length > CLUSTER_NAME_MAX_LENGTH) return 'too-long';
  if (!/^[a-z0-9-]+$/.test(value)) return 'characters';
  if (!CLUSTER_NAME.test(value)) return 'boundary';
  return null;
}
