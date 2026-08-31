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

/**
 * Reads the Azure CLI extensions required by the repository build configuration.
 *
 * @param rootDir - Repository root containing `package.json`.
 * @returns Configured extension names, or an empty array when config cannot be read.
 */
export function readRequiredAzureCliExtensions(rootDir: string): string[] {
  try {
    const rootPackageJson = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf-8")
    );
    return rootPackageJson?.config?.externalTools?.azureCli?.extensions ?? [];
  } catch {
    return [];
  }
}

/**
 * Whether the bundled Azure CLI is expected to carry the required extensions.
 *
 * Windows ships the plain Azure CLI ZIP — the Windows install path in
 * download-az-cli.ts has no extension step — and the app installs required
 * extensions at runtime instead (src/utils/azure/az-extensions.ts). Only the
 * Linux/macOS bundles pre-install extensions, so only they are verified.
 *
 * @param platform - The build platform, as reported by `process.platform`.
 * @returns True when the platform's bundle should contain the extensions.
 */
export function shouldVerifyBundledExtensions(platform: string): boolean {
  return platform !== "win32";
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
