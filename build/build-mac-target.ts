#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Stages tools for the requested macOS architecture, builds Headlamp, and
// packages the matching Electron application.

import { execFileSync } from 'child_process';
import * as path from 'path';
import { resolveTargetArch } from './aks-mcp-config';

const rootDir = path.dirname(__dirname);
const arch = resolveTargetArch();
if (!['x64', 'arm64'].includes(arch)) {
  throw new Error(`Unsupported macOS build architecture: ${arch}`);
}

execFileSync(
  'npx',
  [
    '--yes',
    'tsx',
    path.join(rootDir, 'build', 'setup-plugins.ts'),
    '--platform=darwin',
    `--arch=${arch}`,
  ],
  { cwd: rootDir, stdio: 'inherit' }
);
execFileSync('make', ['app-build'], {
  cwd: path.join(rootDir, 'headlamp'),
  stdio: 'inherit',
});
execFileSync('npm', ['run', 'package', '--', '--mac', `--${arch}`], {
  cwd: path.join(rootDir, 'headlamp', 'app'),
  stdio: 'inherit',
});
