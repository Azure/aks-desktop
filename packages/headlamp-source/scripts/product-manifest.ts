const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PURPOSE = 'Create runtime Headlamp product metadata from consumer configuration.';
const SCRIPT_USAGE = `Import API:

  createProductTemplate(project)
  projectManifest(root?)`;

/**
 * Creates runtime product metadata from consumer configuration.
 *
 * @param project - Parsed consumer package manifest.
 * @returns Product metadata with consumer-only plugin source fields removed.
 */
function createProductTemplate(project: any) {
  if (!project?.headlamp?.product || !Array.isArray(project.headlamp.plugins)) {
    throw new Error('package.json must declare headlamp.product and headlamp.plugins');
  }
  const { plugins, build: _build, ...template } = structuredClone(project.headlamp);
  template.product.version = project.version;
  template.plugins = plugins.map(({ source: _source, ...plugin }) => plugin);
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
  SCRIPT_PURPOSE,
  SCRIPT_USAGE,
  createProductTemplate,
  projectManifest,
};
