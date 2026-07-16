#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as path from "node:path";

import {
  createPluginBuildEnvironment,
  readBuildMetadata,
} from "./build-metadata";
import { runNpmBuildCommand } from "./setup-plugin-build";

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);

export function buildPluginWithMetadata(
  pluginDir: string,
  rootDir = ROOT_DIR,
  environment = process.env
): void {
  runNpmBuildCommand(
    ["run", "build"],
    pluginDir,
    createPluginBuildEnvironment(environment, readBuildMetadata(rootDir))
  );
}

if (require.main === module) {
  const pluginDir = path.resolve(
    process.argv[2] ?? path.join(ROOT_DIR, "plugins", "aks-desktop")
  );

  try {
    buildPluginWithMetadata(pluginDir);
  } catch (error) {
    console.error(
      `Plugin build failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}
