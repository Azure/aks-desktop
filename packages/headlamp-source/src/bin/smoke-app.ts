const SCRIPT_PURPOSE =
  'Launch a packaged Headlamp application headlessly and verify HTTP readiness.';
const SCRIPT_USAGE = `Usage: smoke-app.ts [options]

  --dist <path>        Application distribution directory.
  --executable <path>  Packaged executable; auto-detected when omitted.
  --port <number>      Local readiness port (default: an available port).
  --timeout <ms>       Maximum readiness wait (default: 30000).
  --no-sandbox         Pass Electron's --no-sandbox option.
  --help               Show this help text.`;

const path = require('node:path');
const { resolvePackagedExecutable, smoke } = require('../lib/smoke-app.ts');

/**
 * Reads a command-line option value.
 *
 * @param name - Option name whose following value is requested.
 * @returns The option value, or `undefined` when absent.
 */
function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`${SCRIPT_PURPOSE}\n\n${SCRIPT_USAGE}`);
  } else {
    const dist = option('--dist') || path.resolve(__dirname, '..', '..', 'source', 'app', 'dist');
    const executable = option('--executable') || resolvePackagedExecutable(dist);
    smoke(
      executable,
      Number(option('--port') || 0),
      Number(option('--timeout') || 30_000),
      process.argv.includes('--no-sandbox')
    ).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { SCRIPT_PURPOSE, SCRIPT_USAGE };