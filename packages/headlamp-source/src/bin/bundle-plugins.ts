const SCRIPT_PURPOSE =
  'Bundle configured Headlamp plugins into the shipped-plugins directory.';
const SCRIPT_USAGE = `Usage: bundle-plugins.ts [--help]

Reads headlamp.plugins from the consumer package.json. Workspace plugins are
installed and built; prebuilt package plugins are copied from node_modules.`;

const { bundleConfiguredPlugins } = require('../lib/bundle-plugins.ts');

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`${SCRIPT_PURPOSE}\n\n${SCRIPT_USAGE}`);
  } else {
    bundleConfiguredPlugins();
  }
}

module.exports = { SCRIPT_PURPOSE, SCRIPT_USAGE };