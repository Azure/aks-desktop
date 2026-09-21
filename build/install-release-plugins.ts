#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const { resolveInstalledHeadlampPaths } = require(
  '../packages/headlamp-source/src/lib/paths.ts'
);

const ROOT_DIR = path.dirname(__dirname);

/** Returns the app-manifest subset that installs pinned release plugins. */
export function releasePluginManifest(project: any): { plugins: any[] } {
  const plugins = project?.headlamp?.plugins;
  if (!Array.isArray(plugins)) {
    throw new Error('package.json must declare headlamp.plugins');
  }
  return {
    plugins: plugins.filter(plugin => plugin.archive !== undefined || plugin.file !== undefined),
  };
}

/** Installs release plugins through Headlamp's checksum-verifying app-manifest installer. */
export function installReleasePlugins(rootDir: string = ROOT_DIR): void {
  const project = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const manifest = releasePluginManifest(project);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-release-plugins-'));
  const manifestPath = path.join(temporaryDirectory, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const { appDir } = resolveInstalledHeadlampPaths(rootDir);
  const installer = path.join(appDir, 'scripts', 'setup-plugins.ts');
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', installer], {
      cwd: rootDir,
      env: { ...process.env, HEADLAMP_BUILD_MANIFEST: manifestPath },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Release plugin installation failed with exit code ${result.status}`);
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  installReleasePlugins();
}