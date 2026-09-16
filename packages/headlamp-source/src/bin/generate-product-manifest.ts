const SCRIPT_PURPOSE =
  'Generate or verify product metadata, resources, and external-tool digests.';
const SCRIPT_USAGE = `Usage: generate-product-manifest.ts [--check] [--help]

  --check  Verify the generated manifest without writing changes.
  --help   Show this help text.`;

const { generateManifest, verifyManifest } = require('../lib/generate-product-manifest.ts');

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`${SCRIPT_PURPOSE}\n\n${SCRIPT_USAGE}`);
  } else if (process.argv.includes('--check')) {
    verifyManifest();
  } else {
    generateManifest();
  }
}

module.exports = { SCRIPT_PURPOSE, SCRIPT_USAGE };