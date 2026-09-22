// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'node:fs';
import * as path from 'node:path';

interface ProductIdentity {
  /** Stable product identifier. */
  name?: string;
  /** User-visible product name. */
  productName?: string;
  /** Company attributed in packaged platform metadata. */
  companyName?: string;
  /** Product release version. */
  version?: string;
}

interface ProductConfiguration {
  product?: ProductIdentity;
  platforms?: {
    mac?: {
      executableName?: string;
    };
  };
}

interface PluginIdentity {
  /** Shipped plugin bundle name. */
  name?: string;
  /** Package identity expected in the bundle. */
  packageName?: string;
}

interface LegalDocumentIdentity {
  /** Stable legal document identifier. */
  id?: string;
  /** Packaged legal document file. */
  file?: string;
}

function normalizedIdentities(
  items: unknown,
  fields: string[]
): string[] | undefined {
  if (!Array.isArray(items)) {
    return undefined;
  }
  const identities: string[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      return undefined;
    }
    const record = item as Record<string, unknown>;
    if (fields.some(field => typeof record[field] !== 'string')) {
      return undefined;
    }
    identities.push(JSON.stringify(fields.map(field => record[field])));
  }
  return identities.sort();
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
    actual?.companyName === expected?.companyName &&
    actual?.version === expected?.version
  );
}

/** Resolves the macOS application bundle name from product configuration. */
export function macAppBundleName(config: ProductConfiguration | undefined): string | undefined {
  return config?.platforms?.mac?.executableName ?? config?.product?.productName;
}

/**
 * Checks that configured and packaged plugin identities match exactly.
 *
 * @param actual - Plugins read from the packaged manifest.
 * @param expected - Plugins declared by product configuration.
 * @returns Whether both sets contain the same bundle and package identities.
 */
export function pluginIdentitiesMatch(
  actual: PluginIdentity[] | undefined,
  expected: PluginIdentity[] | undefined
): boolean {
  const actualIdentities = normalizedIdentities(actual, ['name', 'packageName']);
  const expectedIdentities = normalizedIdentities(expected, ['name', 'packageName']);
  return (
    actualIdentities !== undefined &&
    expectedIdentities !== undefined &&
    JSON.stringify(actualIdentities) === JSON.stringify(expectedIdentities)
  );
}

/** Reads every direct shipped-plugin bundle identity from packaged resources. */
export function readPackagedPluginIdentities(
  resourcesDir: string
): PluginIdentity[] | undefined {
  const pluginsDir = path.join(resourcesDir, '.plugins');
  if (!fs.existsSync(pluginsDir)) return undefined;
  try {
    return fs.readdirSync(pluginsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(pluginsDir, entry.name, 'package.json'), 'utf8')
        );
        return { name: entry.name, packageName: manifest.name };
      });
  } catch {
    return undefined;
  }
}

/**
 * Checks that configured and packaged legal document identities match exactly.
 *
 * @param actual - Legal documents read from the packaged manifest.
 * @param expected - Legal documents declared by product configuration.
 * @returns Whether both sets contain the same stable IDs and packaged files.
 */
export function legalDocumentIdentitiesMatch(
  actual: LegalDocumentIdentity[] | undefined,
  expected: LegalDocumentIdentity[] | undefined
): boolean {
  const actualIdentities = normalizedIdentities(actual, ['id', 'file']);
  const expectedIdentities = normalizedIdentities(expected, ['id', 'file']);
  return (
    actualIdentities !== undefined &&
    expectedIdentities !== undefined &&
    JSON.stringify(actualIdentities) === JSON.stringify(expectedIdentities)
  );
}
