/**
 * Builds and validates product-declared plugins before copying them into Headlamp's shipped-plugin
 * directory. Workspace, package, archive, and file-backed plugins share one identity contract.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const VALID_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const VALID_SHA256 = /^[a-f0-9]{64}$/i;

/**
 * Resolves the consumer project root for plugin bundling.
 *
 * @returns The absolute consumer project root.
 */
function projectRoot(): string {
  return path.resolve(process.env.INIT_CWD || process.cwd());
}

/**
 * Reads the consumer project's package manifest.
 *
 * @param root - Consumer project root containing `package.json`.
 * @returns The parsed package manifest.
 */
function readProject(root = projectRoot()) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

/**
 * Resolves and validates a plugin bundle destination.
 *
 * @param pluginsDir - Root directory containing bundled plugins.
 * @param pluginName - Unscoped plugin bundle name.
 * @returns The absolute plugin bundle directory.
 */
function resolvePluginDir(pluginsDir, pluginName) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pluginName)) {
    throw new Error(`Invalid plugin bundle name: ${pluginName}`);
  }
  return path.join(pluginsDir, pluginName);
}

/**
 * Resolves the legacy package-name-based plugin destination.
 *
 * @param pluginsDir - Root directory containing bundled plugins.
 * @param packageName - Plugin package identity, which may be scoped.
 * @returns The validated legacy plugin directory.
 */
function resolveLegacyPluginDir(pluginsDir, packageName) {
  const pluginsRoot = path.resolve(pluginsDir);
  const resolvedPath = path.resolve(pluginsRoot, packageName);
  const relativePath = path.relative(pluginsRoot, resolvedPath);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Invalid plugin package name: ${packageName}`);
  }
  return resolvedPath;
}

/**
 * Runs npm in a plugin workspace and fails on a nonzero exit.
 *
 * @param args - Arguments passed to npm.
 * @param cwd - Working directory in which npm runs.
 * @returns Nothing.
 */
function runNpm(args, cwd) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed in ${cwd}`);
  }
}

/**
 * Verifies that a plugin directory has the configured package identity.
 *
 * @param pluginDir - Directory containing the plugin package.
 * @param plugin - Consumer plugin configuration.
 * @returns Nothing.
 */
function validatePlugin(pluginDir, plugin) {
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
  if (pluginManifest.name !== plugin.packageName) {
    throw new Error(
      `Plugin package mismatch for ${plugin.source}: expected ${plugin.packageName}, found ${pluginManifest.name}`
    );
  }
}

/**
 * Resolves a prebuilt plugin package within the consumer's `node_modules`.
 *
 * @param projectDir - Consumer project root.
 * @param packageName - Plugin package identity to resolve.
 * @returns The real path to the installed plugin package.
 */
function resolvePackagePluginDir(projectDir, packageName) {
  const nodeModulesDir = fs.realpathSync(path.join(projectDir, 'node_modules'));
  const pluginDir = fs.realpathSync(path.join(nodeModulesDir, packageName));
  const relativeSource = path.relative(nodeModulesDir, pluginDir);
  if (
    relativeSource === '..' ||
    relativeSource.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeSource)
  ) {
    throw new Error(`Plugin package must stay within ${nodeModulesDir}: ${packageName}`);
  }
  return pluginDir;
}

/**
 * Copies a built plugin into the shipped-plugin directory.
 *
 * @param pluginDir - Source plugin package directory.
 * @param pluginsDir - Root shipped-plugin destination.
 * @param plugin - Consumer plugin configuration.
 * @param removeLegacy - Whether to remove the legacy package-name destination.
 * @returns The copied plugin's destination directory.
 */
function copyPlugin(pluginDir, pluginsDir, plugin, removeLegacy = true) {
  const targetDir = resolvePluginDir(pluginsDir, plugin.name);
  const legacyTargetDir = resolveLegacyPluginDir(pluginsDir, plugin.packageName);
  validatePlugin(pluginDir, plugin);
  if (removeLegacy && legacyTargetDir !== targetDir) {
    fs.rmSync(legacyTargetDir, { recursive: true, force: true });
    const legacyScopeDir = path.dirname(legacyTargetDir);
    if (
      legacyScopeDir !== path.resolve(pluginsDir) &&
      fs.existsSync(legacyScopeDir) &&
      fs.readdirSync(legacyScopeDir).length === 0
    ) {
      fs.rmdirSync(legacyScopeDir);
    }
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(path.join(pluginDir, 'dist'), targetDir, { recursive: true });
  const targetPackageJson = path.join(targetDir, 'package.json');
  fs.copyFileSync(path.join(pluginDir, 'package.json'), targetPackageJson);
  if (plugin.enabledByDefault !== undefined) {
    const pluginManifest = JSON.parse(fs.readFileSync(targetPackageJson, 'utf8'));
    pluginManifest.headlamp = pluginManifest.headlamp || {};
    pluginManifest.headlamp.enabledByDefault = plugin.enabledByDefault;
    fs.writeFileSync(targetPackageJson, JSON.stringify(pluginManifest, null, 2));
  }
  return targetDir;
}

/**
 * Builds or resolves one configured plugin and copies its distribution.
 *
 * @param projectDir - Consumer project root.
 * @param pluginsDir - Root shipped-plugin destination.
 * @param plugin - Consumer plugin configuration.
 * @returns The copied plugin's destination directory.
 */
function bundlePlugin(projectDir, pluginsDir, plugin) {
  if (plugin.source?.type === 'package') {
    const pluginDir = resolvePackagePluginDir(projectDir, plugin.packageName);
    validatePlugin(pluginDir, plugin);
    return copyPlugin(pluginDir, pluginsDir, plugin, false);
  }

  const pluginDir = fs.realpathSync(path.resolve(projectDir, plugin.source));
  const relativeSource = path.relative(fs.realpathSync(projectDir), pluginDir);
  if (
    relativeSource === '..' ||
    relativeSource.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeSource)
  ) {
    throw new Error(`Plugin source must stay within ${projectDir}: ${plugin.source}`);
  }

  validatePlugin(pluginDir, plugin);
  runNpm(['ci'], pluginDir);
  runNpm(['run', 'build'], pluginDir);
  return copyPlugin(pluginDir, pluginsDir, plugin, false);
}

/**
 * Validates plugin sources, identities, digests, and uniqueness constraints.
 *
 * @param plugins - Consumer plugin configurations to validate.
 * @returns Nothing.
 */
function validatePluginConfiguration(plugins) {
  for (const plugin of plugins) {
    if (typeof plugin.packageName !== 'string' || !VALID_PACKAGE_NAME.test(plugin.packageName)) {
      throw new Error(`Invalid plugin package name: ${plugin.packageName}`);
    }
    if (
      plugin.enabledByDefault !== undefined &&
      typeof plugin.enabledByDefault !== 'boolean'
    ) {
      throw new Error(`Plugin ${plugin.name} enabledByDefault must be a boolean`);
    }
    const sources = ['source', 'archive', 'file'].filter(key => plugin[key] !== undefined);
    if (sources.length !== 1) {
      throw new Error(
        `Plugin ${plugin.name} must declare exactly one of source, archive, or file`
      );
    }
    const source = plugin[sources[0]];
    if (
      sources[0] === 'source' &&
      !(
        (typeof source === 'string' && source.length > 0) ||
        (source && source.type === 'package' && Object.keys(source).length === 1)
      )
    ) {
      throw new Error(
        `Plugin ${plugin.name} source must be a workspace path or {"type":"package"}`
      );
    }
    if (sources[0] !== 'source') {
      if (typeof source !== 'string' || source.length === 0) {
        throw new Error(`Plugin ${plugin.name} ${sources[0]} must be a non-empty string`);
      }
      if (!VALID_SHA256.test(plugin.sha256 || '')) {
        throw new Error(`Plugin ${plugin.name} must declare a valid SHA-256 digest`);
      }
      if (sources[0] === 'archive') {
        let archiveUrl;
        try {
          archiveUrl = new URL(source);
        } catch {
          throw new Error(`Plugin ${plugin.name} archive must be a valid HTTPS URL`);
        }
        if (archiveUrl.protocol !== 'https:') {
          throw new Error(`Plugin ${plugin.name} archive must be a valid HTTPS URL`);
        }
      }
    }
  }
  const bundleNames = plugins.map(plugin => {
    resolvePluginDir('/plugins', plugin.name);
    return plugin.name.toLowerCase();
  });
  if (new Set(bundleNames).size !== bundleNames.length) {
    throw new Error('headlamp.plugins contains duplicate bundle names');
  }
  const packageNames = plugins.map(plugin => {
    resolveLegacyPluginDir('/plugins', plugin.packageName);
    return plugin.packageName.toLowerCase();
  });
  if (new Set(packageNames).size !== packageNames.length) {
    throw new Error('headlamp.plugins contains duplicate package identities');
  }
}

/**
 * Builds and bundles all workspace or package plugins configured by the consumer.
 *
 * @param root - Consumer project root.
 * @param pluginsDir - Root shipped-plugin destination.
 * @returns Nothing.
 */
function bundleConfiguredPlugins(
  root = projectRoot(),
  pluginsDir = path.resolve(__dirname, '..', '..', 'source', '.plugins')
) {
  const project = readProject(root);
  const plugins = project.headlamp?.plugins;
  if (!Array.isArray(plugins)) {
    throw new Error('package.json must declare headlamp.plugins');
  }
  validatePluginConfiguration(plugins);

  fs.rmSync(pluginsDir, { recursive: true, force: true });
  fs.mkdirSync(pluginsDir, { recursive: true });
  for (const plugin of plugins) {
    if (plugin.source !== undefined) {
      bundlePlugin(root, pluginsDir, plugin);
    }
  }
}

module.exports = {
  bundleConfiguredPlugins,
  bundlePlugin,
  copyPlugin,
  resolvePluginDir,
  validatePluginConfiguration,
};
