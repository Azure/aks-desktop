#!/usr/bin/env node

// Copyright (c) Microsoft Corporation. 
// Licensed under the Apache 2.0.

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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
if (!fs.existsSync(externalToolsDir)) {
  console.log('External tools not found. Setting up...');
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
const PLUGINS = ['aks-desktop', 'ai-assistant'];

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
  const targetDir = path.join(ROOT_DIR, 'headlamp', '.plugins', pluginName);
  fs.mkdirSync(targetDir, { recursive: true });

  // Copy dist folder contents
  const distDir = path.join(pluginDir, 'dist');
  fs.readdirSync(distDir).forEach((file) => {
    const src = path.join(distDir, file);
    const dest = path.join(targetDir, file);
    fs.cpSync(src, dest, { recursive: true });
  });

  // Copy package.json
  fs.copyFileSync('./package.json', path.join(targetDir, 'package.json'));

  console.log(`Plugin ${pluginName} has been built and copied to ${targetDir}`);
}

// List the contents of the headlamp plugins directory
console.log(
  'Listing contents of headlamp .plugins directory after copying plugins'
);
console.log(fs.readdirSync(path.join(ROOT_DIR, 'headlamp', '.plugins')));
