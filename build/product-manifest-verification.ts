// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

interface ProductIdentity {
  /** Stable product identifier. */
  name?: string;
  /** User-visible product name. */
  productName?: string;
  /** Product release version. */
  version?: string;
}

/**
 * Checks that packaged product identity matches the configured release.
 *
 * @param actual - Product identity read from the packaged manifest.
 * @param expected - Product identity generated from root product configuration.
 * @returns Whether all identity fields match exactly.
 */
export function productIdentityMatches(
  actual: ProductIdentity | undefined,
  expected: ProductIdentity | undefined
): boolean {
  return (
    actual?.name === expected?.name &&
    actual?.productName === expected?.productName &&
    actual?.version === expected?.version
  );
}
