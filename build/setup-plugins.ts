#!/usr/bin/env node

// Copyright (c) Microsoft Corporation. 
// Licensed under the Apache 2.0.

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { copyShippedPlugin } from './plugin-packaging';
import { matchesChecksum, resolveAksMcpTarget } from './aks-mcp-config';

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);

// Setup external tools (Azure CLI, etc.) if not already present
console.log('==========================================');
console.log('Checking external tools...');
console.log('==========================================');

const externalToolsDir = path.join(
  ROOT_DIR,
  'headlamp',
  'app',
  'resources',
  'external-tools'
);
// Individual tools are checked against their pinned checksum, so incremental
// builds also pick up tools that were added or whose version changed since the
// last setup, without deleting the whole directory.
const aksMcp = resolveAksMcpTarget(ROOT_DIR);
const outdatedExternalTools = [aksMcp].filter(
  tool => !matchesChecksum(tool.targetPath, tool.expectedChecksum)
);
if (!fs.existsSync(externalToolsDir) || outdatedExternalTools.length > 0) {
  if (outdatedExternalTools.length > 0 && fs.existsSync(externalToolsDir)) {
    console.log(
      `Missing or outdated external tools: ${outdatedExternalTools
        .map(tool => tool.targetPath)
        .join(', ')}`
    );
  }
  console.log('Setting up external tools...');
  execSync(
    `npx --yes tsx "${path.join(SCRIPT_DIR, 'setup-external-tools.ts')}"`,
    {
      stdio: 'inherit',
    }
  );
} else {
  console.log('External tools already present. Skipping setup.');
  console.log(`To re-setup, remove: ${externalToolsDir}`);
}

// Ensure we are in the repository with the headlamp directory
if (!fs.existsSync(path.join(ROOT_DIR, 'headlamp'))) {
  console.log("Error: Headlamp repository directory 'headlamp' not found.");
  console.log(`Root directory: ${ROOT_DIR}`);
  console.log(fs.readdirSync(ROOT_DIR));
  process.exit(1);
}

// List of plugins to build and bundle
const PLUGINS = ['aks-desktop', 'ai-assistant', 'insights-plugin'];

for (const plugin of PLUGINS) {
  const pluginDir = path.join(ROOT_DIR, 'plugins', plugin);

  if (!fs.existsSync(pluginDir)) {
    console.log(`Warning: Plugin directory not found: ${pluginDir}. Skipping.`);
    continue;
  }

  process.chdir(pluginDir);

  // Get the current plugin name from package.json
  const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const pluginName = packageJson.name;

  console.log('==========================================');
  console.log(`Building plugin: ${pluginName}`);
  console.log('==========================================');

  // Build the plugin
  execSync('npm install && npm run build', { stdio: 'inherit' });

  console.log(`Copying built files for plugin: ${pluginName}`);
  const pluginsDir = path.join(ROOT_DIR, 'headlamp', '.plugins');
  const targetDir = copyShippedPlugin(pluginDir, pluginsDir, pluginName);

  console.log(`Plugin ${pluginName} has been built and copied to ${targetDir}`);
}

// List the contents of the headlamp plugins directory
console.log(
  'Listing contents of headlamp .plugins directory after copying plugins'
);
console.log(fs.readdirSync(path.join(ROOT_DIR, 'headlamp', '.plugins')));
