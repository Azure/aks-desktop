#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Stages tools for the requested Linux architecture, builds Headlamp, and
// packages the matching Electron application. The bundled Python runs during
// staging, so the worker must already be that architecture.

import { execFileSync } from 'child_process';
import * as path from 'path';
import { resolveTargetArch } from './aks-mcp-config';

const rootDir = path.dirname(__dirname);
const arch = resolveTargetArch();
if (!['x64', 'arm64'].includes(arch)) {
  throw new Error(`Unsupported Linux build architecture: ${arch}`);
}
if (arch !== process.arch) {
  throw new Error(
    `Linux ${arch} bundles must be assembled on a native ${arch} worker; current host is ${process.arch}.`
  );
}

execFileSync(
  'npx',
  [
    '--yes',
    'tsx',
    path.join(rootDir, 'build', 'setup-plugins.ts'),
    '--platform=linux',
    `--arch=${arch}`,
  ],
  { cwd: rootDir, stdio: 'inherit' }
);
execFileSync('make', ['app-build'], {
  cwd: path.join(rootDir, 'headlamp'),
  stdio: 'inherit',
});
execFileSync(
  'npm',
  [
    'run',
    'package',
    '--',
    '--linux',
    'AppImage',
    'tar.gz',
    ...(arch === 'x64' ? ['deb'] : []),
    `--${arch}`,
  ],
  { cwd: path.join(rootDir, 'headlamp', 'app'), stdio: 'inherit' }
);
