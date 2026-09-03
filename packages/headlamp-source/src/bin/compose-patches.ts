const SCRIPT_PURPOSE =
  'Generate or verify the aggregate Headlamp npm patch and lockfile integrity.';
const SCRIPT_USAGE = `Usage: compose-patches.ts [--check] [--help]

  --check  Verify the aggregate patch and integrity without writing changes.
  --help   Show this help text.`;

const { updateHeadlampPatch } = require('../lib/compose-patches.ts');

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`${SCRIPT_PURPOSE}\n\n${SCRIPT_USAGE}`);
  } else {
    updateHeadlampPatch(undefined, process.argv.includes('--check'));
  }
}

module.exports = { SCRIPT_PURPOSE, SCRIPT_USAGE };