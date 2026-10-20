/**
 * Product-manifest helpers shared by generation and tests. Consumer-only build and plugin source
 * fields are removed before runtime metadata is written into the Headlamp application.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * Creates runtime product metadata from consumer configuration.
 *
 * @param project - Parsed consumer package manifest.
 * @param platform - Runtime platform whose product display name is selected.
 * @returns Product metadata with consumer-only plugin source fields removed.
 */
function createProductTemplate(project: any, platform = process.platform) {
  if (!project?.headlamp?.product || !Array.isArray(project.headlamp.plugins)) {
    throw new Error('package.json must declare headlamp.product and headlamp.plugins');
  }
  const { plugins, build: _build, ...template } = structuredClone(project.headlamp);
  const platformKey = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
  const productName = _build?.productNames?.[platformKey];
  if (productName !== undefined) {
    if (typeof productName !== 'string' || !productName.trim()) {
      throw new Error(`Product name for ${platformKey} must be a non-empty string`);
    }
    template.product.productName = productName;
  }
  template.product.version = project.version;
  template.plugins = plugins
    .filter(plugin => plugin.archive !== undefined || plugin.file !== undefined)
    .map(({ source: _source, ...plugin }) => plugin);
  return template;
}

/**
 * Reads the consumer project package manifest.
 *
 * @param root - Consumer project root containing `package.json`.
 * @returns The parsed package manifest.
 */
function projectManifest(root = path.resolve(process.env.INIT_CWD || process.cwd())) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

module.exports = {
  createProductTemplate,
  projectManifest,
};