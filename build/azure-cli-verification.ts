// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from "node:fs";
import * as path from "node:path";

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
  return Object.entries(extensionVersions)
    .filter(([extension, version]) =>
      readInstalledAzureCliExtensionVersion(
        path.join(extensionRoot, extension),
        extension
      ) !== version
    )
    .map(([extension]) => extension);
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
