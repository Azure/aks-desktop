/**
 * Path resolution shared by the source-package scripts and AKS build tooling. Every
 * consumer-provided relative path is constrained to its owning package directory.
 */
const path = require('node:path');

/**
 * Resolves a relative path while preventing traversal outside a root.
 *
 * @param root - Directory that must contain the resolved path.
 * @param relativePath - Path resolved relative to the root.
 * @param name - Human-readable value name used in errors.
 * @returns The validated absolute path.
 */
function resolveWithin(root, relativePath, name) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${name} must stay within ${resolvedRoot}: ${relativePath}`);
  }
  return resolvedPath;
}

/**
 * Resolves standard directories within a Headlamp source package.
 *
 * @param packageDir - Headlamp source package directory.
 * @param manifest - Product manifest path relative to the Headlamp app.
 * @returns Resolved package, source, app, distribution, and manifest paths.
 */
function resolveHeadlampPaths(packageDir, manifest = '.headlamp/product-manifest.json') {
  const resolvedPackageDir = path.resolve(packageDir);
  const sourceDir = path.join(resolvedPackageDir, 'source');
  const appDir = path.join(sourceDir, 'app');
  return {
    packageDir: resolvedPackageDir,
    sourceDir,
    appDir,
    distDir: path.join(appDir, 'dist'),
    manifestPath: resolveWithin(appDir, manifest, 'Product manifest'),
  };
}

/**
 * Resolves Headlamp paths from a consumer project's installed dependency.
 *
 * @param projectDir - Consumer project root.
 * @param manifest - Product manifest path relative to the Headlamp app.
 * @returns Resolved installed package, source, app, distribution, and manifest paths.
 */
function resolveInstalledHeadlampPaths(projectDir, manifest) {
  return resolveHeadlampPaths(
    path.join(projectDir, 'node_modules', '@headlamp-k8s', 'headlamp-source'),
    manifest
  );
}

module.exports = {
  resolveHeadlampPaths,
  resolveInstalledHeadlampPaths,
  resolveWithin,
};