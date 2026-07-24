// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'fs';
import * as path from 'path';

function resolvePluginDir(pluginsDir: string, pluginPath: string) {
  const pluginsRoot = path.resolve(pluginsDir);
  const resolvedPath = path.resolve(pluginsRoot, pluginPath);
  const relativePath = path.relative(pluginsRoot, resolvedPath);

  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Plugin path must stay within ${pluginsRoot}: ${pluginPath}`);
  }

  return resolvedPath;
}

export function copyShippedPlugin(
  pluginDir: string,
  pluginsDir: string,
  pluginName: string
) {
  const targetDir = resolvePluginDir(pluginsDir, path.basename(pluginName));
  const legacyTargetDir = resolvePluginDir(pluginsDir, pluginName);

  if (legacyTargetDir !== targetDir) {
    fs.rmSync(legacyTargetDir, { recursive: true, force: true });
    const legacyScopeDir = path.dirname(legacyTargetDir);
    if (
      fs.existsSync(legacyScopeDir) &&
      fs.readdirSync(legacyScopeDir).length === 0
    ) {
      fs.rmdirSync(legacyScopeDir);
    }
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const distDir = path.join(pluginDir, 'dist');
  fs.readdirSync(distDir).forEach((file) => {
    const src = path.join(distDir, file);
    const dest = path.join(targetDir, file);
    fs.cpSync(src, dest, { recursive: true });
  });

  fs.copyFileSync(
    path.join(pluginDir, 'package.json'),
    path.join(targetDir, 'package.json')
  );

  return targetDir;
}
