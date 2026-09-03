const SCRIPT_PURPOSE =
  'Materialize or update pinned Headlamp source, package metadata, and patch integrity.';
const SCRIPT_USAGE = `Usage:
  update-source.ts --prepare [--root <path>] [--source <checkout>] [--help]
  update-source.ts --source <checkout> [--revision <sha>] [--root <path>] [--help]

  --prepare          Materialize the configured source and aggregate patch.
  --source <path>    Clean Headlamp checkout used instead of fetching source.
  --revision <sha>   Full source revision used in update mode.
  --root <path>      Consumer project root.
  --help             Show this help text.`;

const { prepareHeadlampSource, updateHeadlampSource } = require('../lib/update-source.ts');

/**
 * Reads a command-line option value.
 *
 * @param name - Option name whose following value is requested.
 * @returns The option value, or `undefined` when absent.
 */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`${SCRIPT_PURPOSE}\n\n${SCRIPT_USAGE}`);
  } else {
    const rootDir = argument('--root');
    if (process.argv.includes('--prepare')) {
      prepareHeadlampSource({ rootDir, sourceDir: argument('--source') });
    } else {
      const sourceDir = argument('--source');
      if (!sourceDir) {
        throw new Error(SCRIPT_USAGE);
      }
      updateHeadlampSource({
        rootDir,
        sourceDir,
        revision: argument('--revision'),
      });
    }
  }
}

module.exports = { SCRIPT_PURPOSE, SCRIPT_USAGE };