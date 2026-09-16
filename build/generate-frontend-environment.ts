#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import fs from 'node:fs';
import path from 'node:path';

const { resolveInstalledHeadlampPaths, resolveWithin } = require(
  '../packages/headlamp-source/src/lib/paths.ts'
);

const ROOT_DIR = path.dirname(__dirname);
const OUTPUT_FILE = '.env.local';
const PUBLIC_ENVIRONMENT_KEY = /^REACT_APP_[A-Z0-9_]+$/;

interface ProjectManifest {
  headlamp?: {
    build?: {
      frontendEnvironment?: Record<string, unknown>;
    };
  };
}

export function serializeFrontendEnvironment(environment: Record<string, unknown>): string {
  return `${Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      if (!PUBLIC_ENVIRONMENT_KEY.test(key)) {
        throw new Error(`Frontend environment key must start with REACT_APP_: ${key}`);
      }
      if (typeof value !== 'string' || /[\r\n]/.test(value)) {
        throw new Error(`Frontend environment value must be a single-line string: ${key}`);
      }
      return `${key}=${JSON.stringify(value.replaceAll('$', '\\$'))}`;
    })
    .join('\n')}\n`;
}

export function generateFrontendEnvironment(rootDir = ROOT_DIR): string {
  const project = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')
  ) as ProjectManifest;
  const environment = project.headlamp?.build?.frontendEnvironment;
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('package.json must declare headlamp.build.frontendEnvironment');
  }

  const values = Object.fromEntries(Object.entries(environment).map(([key, value]) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const asset = value as { file?: unknown };
      const extension = typeof asset.file === 'string' ? path.extname(asset.file).toLowerCase() : '';
      const mediaType = extension === '.png' ? 'image/png' : extension === '.svg' ? 'image/svg+xml' : undefined;
      if (Object.keys(asset).length !== 1 || typeof asset.file !== 'string' || !mediaType) {
        throw new Error(`Frontend environment asset must specify a PNG or SVG file: ${key}`);
      }
      const file = resolveWithin(rootDir, asset.file, 'Frontend environment asset');
      return [key, `data:${mediaType};base64,${fs.readFileSync(file).toString('base64')}`];
    }
    return [key, value];
  }));

  const { sourceDir } = resolveInstalledHeadlampPaths(rootDir);
  const outputPath = path.join(sourceDir, 'frontend', OUTPUT_FILE);
  fs.writeFileSync(outputPath, serializeFrontendEnvironment(values));
  return outputPath;
}

if (require.main === module) {
  console.log(`Generated ${generateFrontendEnvironment()}`);
}
