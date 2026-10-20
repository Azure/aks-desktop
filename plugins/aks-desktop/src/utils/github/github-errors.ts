// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Unwrap API context without treating rate limiting as an account-permission failure. */
export function isGitHubAccessDenied(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const failure = error as Error & {
    cause?: unknown;
    status?: number;
    response?: { headers?: Record<string, string | undefined> };
  };
  if (failure.cause instanceof Error) return isGitHubAccessDenied(failure.cause);
  if (failure.status === 401 || failure.status === 404) return true;
  return (
    failure.status === 403 &&
    !failure.response?.headers?.['retry-after'] &&
    failure.response?.headers?.['x-ratelimit-remaining'] !== '0'
  );
}
