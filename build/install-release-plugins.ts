#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const { resolveInstalledHeadlampPaths } = require('../packages/headlamp-source/src/lib/paths.ts');

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

/** Copies local release archives beside the generated manifest. */
export function stageReleasePluginManifest(
  project: any,
  rootDir: string,
  manifestDir: string
): { plugins: any[] } {
  const manifest = releasePluginManifest(project);
  const realRoot = fs.realpathSync(rootDir);
  return {
    plugins: manifest.plugins.map((plugin, index) => {
      if (plugin.file === undefined) return plugin;
      if (typeof plugin.file !== 'string' || plugin.file.length === 0) {
        throw new Error(`Release plugin ${plugin.name ?? index} must use a non-empty file path`);
      }
      const sourcePath = fs.realpathSync(path.resolve(realRoot, plugin.file));
      const relativeSource = path.relative(realRoot, sourcePath);
      if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
        throw new Error(`Release plugin file must stay within the project root: ${plugin.file}`);
      }
      const stagedName = `${index}-${path.basename(sourcePath)}`;
      fs.copyFileSync(sourcePath, path.join(manifestDir, stagedName));
      return { ...plugin, file: stagedName };
    }),
  };
}

/** Installs release plugins through Headlamp's checksum-verifying app-manifest installer. */
export function installReleasePlugins(rootDir: string = ROOT_DIR): void {
  const project = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-release-plugins-'));
  const manifestPath = path.join(temporaryDirectory, 'manifest.json');
  const { appDir } = resolveInstalledHeadlampPaths(rootDir);
  const installer = path.join(appDir, 'scripts', 'setup-plugins.ts');
  try {
    const manifest = stageReleasePluginManifest(project, rootDir, temporaryDirectory);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
