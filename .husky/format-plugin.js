#!/usr/bin/env node
// Cross-platform script for formatting plugin files
const { execSync } = require('child_process');
const path = require('path');

const files = process.argv.slice(2);
if (files.length === 0) process.exit(0);

// Convert absolute paths to relative paths from plugin directory
const pluginDir = path.join(__dirname, '..', 'plugins', 'aks-desktop');
const relativeFiles = files.map(f => path.relative(pluginDir, f));

try {
  execSync(`npx prettier --write ${relativeFiles.join(' ')}`, {
    cwd: pluginDir,
    stdio: 'inherit'
  });
} catch (error) {
  process.exit(error.status || 1);
}

