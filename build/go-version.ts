#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GO_MOD = path.join(
  SCRIPT_DIR,
  '..',
  'packages',
  'headlamp-source',
  'source',
  'backend',
  'go.mod'
);
const DEFAULT_PACKAGE_MANIFEST = path.join(
  SCRIPT_DIR,
  '..',
  'packages',
  'headlamp-source',
  'package.json'
);

/** Resolves the preferred Go version from a module's toolchain or go directive. */
export function resolveGoVersion(goMod: string): string {
  const toolchain = goMod.match(/^toolchain\s+go([^\s]+)$/m)?.[1];
  const languageVersion = goMod.match(/^go\s+([^\s]+)$/m)?.[1];
  const version = toolchain || languageVersion;
  if (!version || !/^\d+\.\d+(?:\.\d+)?$/.test(version)) {
    throw new Error('No valid Go version found');
  }
  return version;
}

/** Reads and resolves the Go version from Headlamp's backend module. */
export function readHeadlampGoVersion(
  goModPath: string = DEFAULT_GO_MOD,
  packageManifestPath: string = DEFAULT_PACKAGE_MANIFEST
): string {
  if (fs.existsSync(goModPath)) {
    return resolveGoVersion(fs.readFileSync(goModPath, 'utf8'));
  }
  const manifest = JSON.parse(fs.readFileSync(packageManifestPath, 'utf8'));
  return resolveGoVersion(`toolchain go${manifest.headlampSource?.goVersion ?? ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(readHeadlampGoVersion(process.argv[2]));
}