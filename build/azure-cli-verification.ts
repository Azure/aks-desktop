// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

/** Result emitted by one bundled-tool verification check. */
export interface ToolVerificationResult {
  /** Human-readable check name shown in the verification summary. */
  name: string;
  /** Whether the bundled tool satisfies this check. */
  passed: boolean;
  /** Diagnostic detail shown with the check result. */
  message: string;
}

function normalizedDistributionName(name: string): string {
  return name.toLowerCase().replaceAll('_', '-');
}

/** Reads an extension's installed distribution version from wheel metadata. */
export function readInstalledAzureCliExtensionVersion(
  extensionDir: string,
  extension: string
): string | undefined {
  if (!fs.existsSync(extensionDir)) return undefined;
  for (const entry of fs.readdirSync(extensionDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue;
    const metadataPath = path.join(extensionDir, entry.name, 'METADATA');
    if (!fs.existsSync(metadataPath)) continue;
    const metadata = fs.readFileSync(metadataPath, 'utf8');
    const name = metadata.match(/^Name:\s*(.+)$/m)?.[1]?.trim();
    const version = metadata.match(/^Version:\s*(.+)$/m)?.[1]?.trim();
    if (name && version && normalizedDistributionName(name) === normalizedDistributionName(extension)) {
      return version;
    }
  }
  return undefined;
}

/** Returns pinned extensions whose installed wheel metadata is absent or stale. */
export function invalidInstalledAzureCliExtensions(
  extensionRoot: string,
  extensionVersions: Record<string, string>
): string[] {
  const invalidConfigured = Object.entries(extensionVersions)
    .filter(([extension, version]) =>
      readInstalledAzureCliExtensionVersion(
        path.join(extensionRoot, extension),
        extension
      ) !== version
    )
    .map(([extension]) => extension);
  if (!fs.existsSync(extensionRoot)) return invalidConfigured;
  const configured = new Set(Object.keys(extensionVersions));
  const unexpected = fs.readdirSync(extensionRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !configured.has(entry.name))
    .map(entry => entry.name);
  return [...invalidConfigured, ...unexpected].sort();
}

function installedWheelPath(relativePath: string): string {
  const dataPath = relativePath.match(/^[^/]+\.data\/(?:purelib|platlib)\/(.+)$/);
  if (dataPath) return dataPath[1];
  const scriptPath = relativePath.match(/^[^/]+\.data\/scripts\/(.+)$/);
  if (scriptPath) return `bin/${scriptPath[1]}`;
  return relativePath;
}

function recordRelativePaths(recordContents: string): string[] {
  return recordContents.split('\n').flatMap(line => {
    if (!line) return [];
    const record = line.match(/^"?([^",]+)"?,([^,]*),/);
    return record?.[1] ? [installedWheelPath(record[1])] : [];
  });
}

/** Returns absent or modified files listed by wheel RECORD metadata. */
export function missingInstalledWheelFiles(
  extensionDir: string,
  authenticatedRecord?: string
): string[] {
  if (!fs.existsSync(extensionDir)) return [extensionDir];
  const missing: string[] = [];
  const records: string[] = [];
  if (authenticatedRecord !== undefined) {
    records.push(authenticatedRecord);
  } else {
    for (const entry of fs.readdirSync(extensionDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue;
      const recordPath = path.join(extensionDir, entry.name, 'RECORD');
      if (!fs.existsSync(recordPath)) {
        missing.push(`${entry.name}/RECORD`);
      } else {
        records.push(fs.readFileSync(recordPath, 'utf8'));
      }
    }
  }
  for (const recordContents of records) {
    for (const line of recordContents.split('\n')) {
      if (!line) continue;
      const record = line.match(/^"?([^",]+)"?,([^,]*),/);
      const relativePath = record?.[1] ? installedWheelPath(record[1]) : undefined;
      const hash = record?.[2];
      if (!relativePath || !hash?.startsWith('sha256=')) continue;
      const installedPath = path.resolve(extensionDir, relativePath);
      const relativeInstalledPath = path.relative(extensionDir, installedPath);
      if (relativeInstalledPath.startsWith('..') || path.isAbsolute(relativeInstalledPath)) {
        continue;
      }
      if (!fs.existsSync(installedPath)) {
        missing.push(relativePath);
      } else if (authenticatedRecord !== undefined) {
        const expectedHash = hash.slice('sha256='.length).replace(/=+$/, '');
        const actualHash = createHash('sha256')
          .update(fs.readFileSync(installedPath))
          .digest('base64url');
        if (actualHash !== expectedHash) {
          missing.push(`${relativePath} (checksum mismatch)`);
        }
      }
    }
  }
  return missing.sort();
}

/** Returns installed files not covered by authenticated wheel RECORD metadata. */
export function unexpectedInstalledWheelFiles(
  extensionDir: string,
  authenticatedRecords: string[]
): string[] {
  const expected = new Set(authenticatedRecords.flatMap(recordRelativePaths));
  const unexpected: string[] = [];
  const pending = [extensionDir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      const relativePath = path.relative(extensionDir, entryPath);
      const pipReceipt = /\.dist-info\/(?:INSTALLER|REQUESTED|direct_url\.json)$/.test(
        relativePath
      );
      if (!expected.has(relativePath) && !pipReceipt) {
        unexpected.push(relativePath);
      }
    }
  }
  return unexpected.sort();
}

/** Returns locked wheel distributions absent from an installed extension. */
export function missingInstalledWheelDistributions(
  installed: Iterable<string>,
  expected: Iterable<string>
): string[] {
  const installedNames = new Set([...installed].map(name => normalizedDistributionName(name)));
  return [...expected]
    .map(name => normalizedDistributionName(name))
    .filter(name => !installedNames.has(name))
    .sort();
}

/** Returns whether a packaged native runtime can execute on the current host. */
export function canInvokePackagedRuntime(
  targetPlatform: string,
  runtimeArch: string,
  hostPlatform: string = process.platform,
  hostArch: string = process.arch
): boolean {
  return targetPlatform === hostPlatform && runtimeArch === hostArch;
}

/**
 * Reads the Azure CLI extensions required by the repository build configuration.
 *
 * @param rootDir - Repository root containing `package.json`.
 * @returns Configured extension names, or an empty array when config cannot be read
 *   or is not a list.
 */
export function readRequiredAzureCliExtensions(rootDir: string): string[] {
  try {
    const rootPackageJson = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf-8")
    );
    const extensions = rootPackageJson?.config?.externalTools?.azureCli?.extensions;
    return Array.isArray(extensions) ? extensions : [];
  } catch {
    return [];
  }
}

/** Reads exact versions required for configured Azure CLI extensions. */
export function readRequiredAzureCliExtensionVersions(rootDir: string): Record<string, string> {
  try {
    const rootPackageJson = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf-8")
    );
    const versions = rootPackageJson?.config?.externalTools?.azureCli?.extensionVersions;
    if (!versions || typeof versions !== "object" || Array.isArray(versions)) return {};
    return Object.fromEntries(
      Object.entries(versions).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

/**
 * Builds the failed extension result used when `az version` times out.
 *
 * @param requiredExtensions - Extensions whose bundled versions could not be verified.
 * @returns A failed verification result listing every required extension.
 */
export function getExtensionTimeoutResult(
  requiredExtensions: string[]
): ToolVerificationResult {
  return {
    name: "Azure CLI extensions",
    passed: false,
    message: `Could not verify required extensions after Azure CLI invocation timed out: ${requiredExtensions.join(
      ", "
    )}`,
  };
}
