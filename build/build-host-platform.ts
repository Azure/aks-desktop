#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Runs the packaging script for the host platform. Each platform script stages
 * the bundled tools for the architectures it packages, which a single
 * multi-platform electron-builder invocation cannot do.
 */

import { execSync } from 'child_process';
import * as path from 'path';

const SCRIPTS: Record<string, string> = {
  linux: 'build:linux',
  darwin: 'build:mac',
  win32: 'build:win',
};

const script = SCRIPTS[process.platform];

if (!script) {
  console.error(`Unsupported build platform: ${process.platform}`);
  process.exit(1);
}

console.log(`Building for ${process.platform} via "npm run ${script}"`);
execSync(`npm run ${script}`, {
  stdio: 'inherit',
  cwd: path.dirname(__dirname),
});
