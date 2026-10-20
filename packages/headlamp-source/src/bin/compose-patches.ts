const SCRIPT_PURPOSE =
  'Generate, verify, or apply the aggregate Headlamp package patch.';
const SCRIPT_USAGE = `Usage: compose-patches.ts [--check | --apply <package>] [--help]

  --check            Verify the aggregate patch and integrity without writing changes.
  --apply <package>  Apply the patch unless npm already applied it.
  --help             Show this help text.`;

const { applyHeadlampPatch, updateHeadlampPatch } = require('../lib/compose-patches.ts');

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`${SCRIPT_PURPOSE}\n\n${SCRIPT_USAGE}`);
  } else {
    const applyIndex = process.argv.indexOf('--apply');
    if (applyIndex !== -1) {
      const packageDir = process.argv[applyIndex + 1];
      if (!packageDir) {
        throw new Error(SCRIPT_USAGE);
      }
      applyHeadlampPatch(undefined, packageDir);
    } else {
      updateHeadlampPatch(undefined, process.argv.includes('--check'));
    }
  }
}

module.exports = { SCRIPT_PURPOSE, SCRIPT_USAGE };