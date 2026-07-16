#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  createPluginBuildEnvironment,
  readBuildMetadata,
} from "./build-metadata";
import { installAndBuildPlugin } from "./setup-plugin-build";

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);
const PLUGINS = ["aks-desktop", "ai-assistant", "insights-plugin"];

interface SetupPluginsOptions {
  buildPlugin?: typeof installAndBuildPlugin;
  environment?: NodeJS.ProcessEnv;
  log?: (message: string | string[]) => void;
  rootDir?: string;
  setupExternalTools?: (scriptPath: string) => void;
}

function defaultSetupExternalTools(scriptPath: string): void {
  execSync(`npx --yes tsx "${scriptPath}"`, { stdio: "inherit" });
}

export function setupPlugins({
  buildPlugin = installAndBuildPlugin,
  environment = process.env,
  log = console.log,
  rootDir = ROOT_DIR,
  setupExternalTools = defaultSetupExternalTools,
}: SetupPluginsOptions = {}): void {
  const scriptDir = path.join(rootDir, "build");
  const headlampDir = path.join(rootDir, "headlamp");
  const externalToolsDir = path.join(
    headlampDir,
    "app",
    "resources",
    "external-tools"
  );

  if (!fs.existsSync(headlampDir)) {
    throw new Error(
      `Headlamp repository directory not found. Root directory: ${rootDir}`
    );
  }

  log("==========================================");
  log("Checking external tools...");
  log("==========================================");

  if (!fs.existsSync(externalToolsDir)) {
    log("External tools not found. Setting up...");
    setupExternalTools(path.join(scriptDir, "setup-external-tools.ts"));
  } else {
    log("External tools already present. Skipping setup.");
    log(`To re-setup, remove: ${externalToolsDir}`);
  }

  const pluginBuildEnvironment = createPluginBuildEnvironment(
    environment,
    readBuildMetadata(rootDir)
  );

  for (const plugin of PLUGINS) {
    const pluginDir = path.join(rootDir, "plugins", plugin);

    if (!fs.existsSync(pluginDir)) {
      log(`Warning: Plugin directory not found: ${pluginDir}. Skipping.`);
      continue;
    }

    const packageJsonPath = path.join(pluginDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const pluginName = packageJson.name;

    log("==========================================");
    log(`Building plugin: ${pluginName}`);
    log("==========================================");

    buildPlugin(pluginDir, pluginBuildEnvironment);

    log(`Copying built files for plugin: ${pluginName}`);
    const targetDir = path.join(headlampDir, ".plugins", pluginName);
    fs.rmSync(targetDir, { force: true, recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    const distDir = path.join(pluginDir, "dist");
    fs.readdirSync(distDir).forEach((file) => {
      fs.cpSync(path.join(distDir, file), path.join(targetDir, file), {
        recursive: true,
      });
    });

    fs.copyFileSync(packageJsonPath, path.join(targetDir, "package.json"));
    log(`Plugin ${pluginName} has been built and copied to ${targetDir}`);
  }

  log("Listing contents of headlamp .plugins directory after copying plugins");
  const headlampPluginsDir = path.join(headlampDir, ".plugins");
  log(fs.existsSync(headlampPluginsDir) ? fs.readdirSync(headlampPluginsDir) : []);
}

if (require.main === module) {
  try {
    setupPlugins();
  } catch (error) {
    console.error(
      `Plugin setup failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}
