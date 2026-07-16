#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from "node:fs";
import * as path from "node:path";

import { type BuildMetadata, readBuildMetadata } from "./build-metadata";

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);
const DEFAULT_BUNDLE_PATH = path.join(
  ROOT_DIR,
  "plugins",
  "aks-desktop",
  "dist",
  "main.js"
);

function assertExpectedVersion(version: string, productName: string): void {
  if (!version.trim() || version.trim().toLowerCase() === "unknown") {
    throw new Error(`${productName} version must not be empty or "unknown".`);
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveIdentifierValue(
  bundleContents: string,
  identifier: string
): string | undefined {
  const escapedIdentifier = escapeRegularExpression(identifier);
  const match = new RegExp(
    `(?:^|[;,])\\s*(?:(?:const|let|var)\\s+)?${escapedIdentifier}\\s*=\\s*(["'])([^"'\\r\\n]*)\\1`
  ).exec(bundleContents);
  return match?.[2];
}

function resolvePropertyValues(
  bundleContents: string,
  propertyName: string
): string[] {
  const escapedPropertyName = escapeRegularExpression(propertyName);
  const propertyPattern = new RegExp(
    `(?<![\\w$])${escapedPropertyName}(?![\\w$])\\s*:\\s*(?:(["'])([^"'\\r\\n]*)\\1|([A-Za-z_$][\\w$]*))`,
    "g"
  );
  const values: string[] = [];

  for (const match of bundleContents.matchAll(propertyPattern)) {
    if (match[2] !== undefined) {
      values.push(match[2]);
      continue;
    }

    const resolvedValue = resolveIdentifierValue(bundleContents, match[3]);
    if (resolvedValue !== undefined) {
      values.push(resolvedValue);
    }
  }

  return values;
}

function assertBundleVersion(
  bundleContents: string,
  propertyName: string,
  expectedVersion: string,
  productName: string
): void {
  const propertyValues = resolvePropertyValues(bundleContents, propertyName);

  if (propertyValues.some((value) => value.toLowerCase() === "unknown")) {
    throw new Error(
      `${productName} version is "unknown" in the plugin bundle.`
    );
  }
  if (propertyValues.includes("")) {
    throw new Error(`${productName} version is empty in the plugin bundle.`);
  }
  if (!propertyValues.includes(expectedVersion)) {
    throw new Error(
      `${productName} version ${expectedVersion} is missing from the plugin bundle.`
    );
  }
}

export function verifyPluginBundleMetadata(
  bundleContents: string,
  metadata: BuildMetadata
): void {
  assertExpectedVersion(metadata.aksDesktopVersion, "AKS Desktop");
  assertExpectedVersion(metadata.headlampVersion, "Headlamp");

  assertBundleVersion(
    bundleContents,
    "appVersion",
    metadata.aksDesktopVersion,
    "AKS Desktop"
  );
  assertBundleVersion(
    bundleContents,
    "headlampVersion",
    metadata.headlampVersion,
    "Headlamp"
  );
}

export function verifyPluginBundleFile(
  bundlePath = DEFAULT_BUNDLE_PATH,
  rootDir = ROOT_DIR
): void {
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Plugin bundle not found: ${bundlePath}`);
  }

  verifyPluginBundleMetadata(
    fs.readFileSync(bundlePath, "utf8"),
    readBuildMetadata(rootDir)
  );
}

if (require.main === module) {
  try {
    verifyPluginBundleFile(process.argv[2]);
    console.log("Plugin build metadata verification passed.");
  } catch (error) {
    console.error(
      `Plugin build metadata verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}
