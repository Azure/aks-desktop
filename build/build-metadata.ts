// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from "node:fs";
import * as path from "node:path";

export interface BuildMetadata {
  aksDesktopVersion: string;
  headlampVersion: string;
}

const VERSION_ENVIRONMENT_VARIABLES = {
  aksDesktopVersion: "REACT_APP_AKS_DESKTOP_VERSION",
  headlampVersion: "REACT_APP_HEADLAMP_VERSION",
} as const;

function readPackageVersion(packagePath: string, productName: string): string {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    version?: unknown;
  };
  return validateVersion(packageJson.version, productName);
}

function validateVersion(value: unknown, productName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${productName} version must be a non-empty string.`);
  }

  const version = value.trim();
  if (!version || version.toLowerCase() === "unknown") {
    throw new Error(`${productName} version must not be empty or "unknown".`);
  }

  return version;
}

export function readBuildMetadata(rootDir: string): BuildMetadata {
  return {
    aksDesktopVersion: readPackageVersion(
      path.join(rootDir, "package.json"),
      "AKS Desktop"
    ),
    headlampVersion: readPackageVersion(
      path.join(rootDir, "headlamp", "app", "package.json"),
      "Headlamp"
    ),
  };
}

function assertCompatibleAmbientVersion(
  environment: NodeJS.ProcessEnv,
  environmentVariable: string,
  packageVersion: string
): void {
  const ambientVersion = environment[environmentVariable];
  if (ambientVersion === undefined) {
    return;
  }

  const validatedAmbientVersion = validateVersion(
    ambientVersion,
    environmentVariable
  );
  if (validatedAmbientVersion !== packageVersion) {
    throw new Error(
      `${environmentVariable} must match package metadata (${packageVersion}); ` +
        `received ${validatedAmbientVersion}. Package metadata is authoritative.`
    );
  }
}

export function createPluginBuildEnvironment(
  environment: NodeJS.ProcessEnv,
  metadata: BuildMetadata
): NodeJS.ProcessEnv {
  const aksDesktopVersion = validateVersion(
    metadata.aksDesktopVersion,
    "AKS Desktop"
  );
  const headlampVersion = validateVersion(metadata.headlampVersion, "Headlamp");

  assertCompatibleAmbientVersion(
    environment,
    VERSION_ENVIRONMENT_VARIABLES.aksDesktopVersion,
    aksDesktopVersion
  );
  assertCompatibleAmbientVersion(
    environment,
    VERSION_ENVIRONMENT_VARIABLES.headlampVersion,
    headlampVersion
  );

  return {
    ...environment,
    [VERSION_ENVIRONMENT_VARIABLES.aksDesktopVersion]: aksDesktopVersion,
    [VERSION_ENVIRONMENT_VARIABLES.headlampVersion]: headlampVersion,
  };
}
