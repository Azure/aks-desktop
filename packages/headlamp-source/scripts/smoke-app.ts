const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const SCRIPT_PURPOSE =
  'Launch a packaged Headlamp application headlessly and verify HTTP readiness.';
const SCRIPT_USAGE = `Usage: smoke-app.ts [options]

  --dist <path>        Application distribution directory.
  --executable <path>  Packaged executable; auto-detected when omitted.
  --port <number>      Local readiness port (default: an available port).
  --timeout <ms>       Maximum readiness wait (default: 30000).
  --no-sandbox         Pass Electron's --no-sandbox option.
  --help               Show this help text.`;

/**
 * Reads the value following a command-line option.
 *
 * @param args - Command-line arguments to search.
 * @param name - Option name whose value is requested.
 * @returns The option value, or `undefined` when absent.
 */
function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * Reads and validates the consumer's Headlamp product configuration.
 *
 * @param root - Consumer project root containing `package.json`.
 * @returns The configured `headlamp` object.
 */
function readProductConfig(root = path.resolve(process.env.INIT_CWD || process.cwd())) {
  const project = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!project.headlamp?.product) {
    throw new Error('package.json must declare headlamp.product');
  }
  return project.headlamp;
}

/**
 * Lists platform-specific locations where Electron may emit the application executable.
 *
 * @param dist - Headlamp app distribution directory.
 * @param manifest - Product configuration used to derive executable names.
 * @param platform - Runtime platform to resolve.
 * @param architecture - CPU architecture to resolve.
 * @returns Ordered executable path candidates.
 */
function packagedExecutableCandidates(
  dist,
  manifest = readProductConfig(),
  platform = process.platform,
  architecture = process.arch
) {
  const productName = manifest.product.productName;
  const manifestPlatform =
    platform === 'darwin'
      ? 'mac'
      : platform === 'linux'
      ? 'linux'
      : platform === 'win32'
      ? 'win'
      : undefined;
  const executableName =
    (manifestPlatform ? manifest.platforms?.[manifestPlatform]?.executableName : undefined) ||
    productName ||
    manifest.product.name;
  if (!executableName) {
    return [];
  }

  if (platform === 'darwin') {
    const otherArchitecture = architecture === 'arm64' ? 'x64' : 'arm64';
    return [`mac-${architecture}`, `mac-${otherArchitecture}`, 'mac-universal', 'mac'].map(
      directory =>
        path.resolve(dist, directory, `${productName}.app`, 'Contents', 'MacOS', executableName)
    );
  }
  if (platform === 'win32') {
    return [`win-${architecture}-unpacked`, 'win-unpacked'].map(directory =>
      path.resolve(dist, directory, `${executableName}.exe`)
    );
  }
  if (platform === 'linux') {
    return [`linux-${architecture}-unpacked`, 'linux-unpacked'].map(directory =>
      path.resolve(dist, directory, executableName)
    );
  }
  return [];
}

/**
 * Finds the first packaged executable emitted for the current product.
 *
 * @param dist - Headlamp app distribution directory.
 * @returns The existing packaged executable path.
 */
function resolvePackagedExecutable(dist) {
  const candidates = packagedExecutableCandidates(dist);
  const executable = candidates.find(
    candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
  if (!executable) {
    throw new Error(`Packaged executable was not found; checked: ${candidates.join(', ')}`);
  }
  return executable;
}

/**
 * Exclusively reserves a local port until the caller is ready to launch.
 *
 * @param requestedPort - Requested port, or zero to let the OS select one.
 * @returns The selected port and an async function that releases it.
 */
function reserveReadinessPort(requestedPort = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: requestedPort, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a local readiness port'));
        return;
      }
      resolve({
        port: address.port,
        release: () =>
          new Promise<void>((done, fail) =>
            server.close(error => (error ? fail(error) : done()))
          ),
      });
    });
  });
}

/**
 * Lists descendant process IDs in child-first termination order.
 *
 * @param rootPid - Process ID whose descendants are discovered.
 * @returns Descendant process IDs, or an empty array when discovery fails.
 */
function descendantProcessIds(rootPid) {
  const result = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
  if (result.status !== 0) {
    return [];
  }
  const children = new Map();
  for (const line of result.stdout.trim().split(/\r?\n/)) {
    const [pid, parent] = line.trim().split(/\s+/).map(Number);
    children.set(parent, [...(children.get(parent) || []), pid]);
  }
  const descendants = [];
  /**
   * Visits a process subtree and records children after their descendants.
   *
   * @param pid - Parent process ID to visit.
   * @returns Nothing.
   */
  const visit = pid => {
    for (const child of children.get(pid) || []) {
      visit(child);
      descendants.push(child);
    }
  };
  visit(rootPid);
  return descendants;
}

/**
 * Terminates a spawned application and all of its descendants.
 *
 * @param child - Spawned child process to terminate.
 * @returns A promise that resolves after termination attempts complete.
 */
async function terminateProcessTree(child) {
  if (!child.pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  } else {
    const processIds = [...descendantProcessIds(child.pid), child.pid];
    for (const pid of processIds) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    for (const pid of processIds) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

/**
 * Fetches and consumes an HTML response within a bounded interval.
 *
 * @param url - HTTP endpoint to probe.
 * @param timeout - Maximum request and body duration in milliseconds.
 * @param fetchFn - Fetch implementation, injectable for tests.
 * @returns Whether the endpoint returned a successful response containing HTML.
 */
async function fetchHtmlWithin(url, timeout, fetchFn = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeout));
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    return response.ok && (await response.text()).includes('<html');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Launches a packaged application and waits for its local HTTP endpoint.
 *
 * @param executable - Packaged application executable.
 * @param port - Local port passed to the application.
 * @param timeout - Maximum readiness wait in milliseconds.
 * @param disableSandbox - Whether to pass Electron's `--no-sandbox` option.
 * @returns A promise that resolves when the smoke check passes.
 */
async function smoke(executable, port, timeout, disableSandbox) {
  const reservation: any = await reserveReadinessPort(port);
  const readinessPort = reservation.port;
  await reservation.release();
  const args = ['--headless', '--disable-gpu', '--port', String(readinessPort)];
  if (disableSandbox) {
    args.unshift('--no-sandbox');
  }
  const child = spawn(executable, args, {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError;
  child.once('error', error => {
    spawnError = error;
  });
  child.stdout?.on('data', chunk => (output += chunk));
  child.stderr?.on('data', chunk => (output += chunk));

  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`Could not start packaged application: ${spawnError.message}`);
      }
      if (child.exitCode !== null) {
        throw new Error(`Packaged application exited before becoming ready:\n${output}`);
      }
      try {
        const remainingMs = deadline - Date.now();
        if (
          await fetchHtmlWithin(
            `http://127.0.0.1:${readinessPort}`,
            remainingMs
          )
        ) {
          console.log(`Packaged application smoke check passed on port ${readinessPort}.`);
          return;
        }
      } catch {}
      const retryDelayMs = Math.min(500, deadline - Date.now());
      if (retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
    throw new Error(`Packaged application did not become ready within ${timeout}ms:\n${output}`);
  } finally {
    await terminateProcessTree(child);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`${SCRIPT_PURPOSE}\n\n${SCRIPT_USAGE}`);
  } else {
    const dist = option(args, '--dist') || path.resolve(__dirname, '..', 'source', 'app', 'dist');
    const executable = option(args, '--executable') || resolvePackagedExecutable(dist);
    smoke(
      executable,
      Number(option(args, '--port') || 0),
      Number(option(args, '--timeout') || 30_000),
      args.includes('--no-sandbox')
    ).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  SCRIPT_PURPOSE,
  SCRIPT_USAGE,
  packagedExecutableCandidates,
  fetchHtmlWithin,
  reserveReadinessPort,
  resolvePackagedExecutable,
  smoke,
};
