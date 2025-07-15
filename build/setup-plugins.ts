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

// Go to the plugin directory
const pluginDir = path.join(ROOT_DIR, 'plugins', 'aks-desktop');
process.chdir(pluginDir);

// Ensure we are in the repository with the headlamp directory
if (!fs.existsSync(path.join(ROOT_DIR, 'headlamp'))) {
  console.log("Error: Headlamp repository directory 'headlamp' not found.");
  console.log(`Current directory: ${process.cwd()}`);
  console.log(`Root directory: ${ROOT_DIR}`);
  console.log(fs.readdirSync('.'));
  process.exit(1);
}

// Get the current plugin name from package.json
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const pluginName = packageJson.name;

console.log(`Building plugin: ${pluginName}`);

// Build the aks-plugin
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

// List the contents of the headlamp plugins directory
console.log(
  'Listing contents of headlamp .plugins directory after copying plugin'
);
console.log(fs.readdirSync(path.join(ROOT_DIR, 'headlamp', '.plugins')));

console.log(`Plugin ${pluginName} has been built and copied to ${targetDir}`);
