// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Run through npm run ci:windows so npm_execpath identifies the working bootstrap CLI.
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

function signingChildEnvironment(env) {
  const sanitized = { ...env };
  for (const name of Object.keys(sanitized)) {
    const upper = name.toUpperCase();
    if (
      [
        'SYSTEM_ACCESSTOKEN',
        'ENDPOINT_AUTH_SYSTEMVSSCONNECTION',
        'ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN',
      ].includes(upper) ||
      (upper.startsWith('AKSD_ESRP_') && upper !== 'AKSD_ESRP_REQUIRED')
    ) {
      delete sanitized[name];
    }
  }
  return sanitized;
}

async function signingBroker(env) {
  if (env.AKSD_ESRP_REQUIRED !== 'true') return { env, close: async () => undefined };
  if (!env.SYSTEM_ACCESSTOKEN) {
    throw new Error('Required ESRP job token is unavailable');
  }
  const secret = randomBytes(32).toString('base64url');
  const worker = new Worker(path.join(__dirname, 'esrp-sign-broker.cjs'), {
    workerData: {
      secret,
      outputRoot: path.resolve(
        __dirname,
        '../node_modules/@headlamp-k8s/headlamp-source/source/app/dist'
      ),
    },
  });
  const url = await new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`Signing broker exited with ${code}`));
    });
  });
  return {
    env: {
      ...signingChildEnvironment(env),
      AKSD_ESRP_BROKER_URL: url,
      AKSD_ESRP_BROKER_TOKEN: secret,
    },
    close: () => new Promise(resolve => {
      worker.once('exit', resolve);
      worker.postMessage('close');
    }),
  };
}

async function main() {
  const { packageManager } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const version = /^npm@(\d+\.\d+\.\d+)$/.exec(packageManager || '')?.[1];
  if (!version) throw new Error('Windows CI requires an exact npm version in packageManager');
  const toolDir = path.resolve('.config', 'npm');
  const toolManifest = JSON.parse(fs.readFileSync(path.join(toolDir, 'package.json'), 'utf8'));
  if (toolManifest.dependencies?.npm !== version) {
    throw new Error('CI npm dependency must match packageManager');
  }
  const bootstrapCli = process.env.npm_execpath;
  if (!bootstrapCli || !fs.existsSync(bootstrapCli)) {
    throw new Error('Missing npm_execpath; invoke through npm run ci:windows');
  }

  // Keep npm outside the checkout: npm ci removes the checkout's node_modules.
  // Node creates native Windows paths; none pass through MSYS conversion or Bash PATH.
  const npmRoot = fs.mkdtempSync(path.join(process.env.AGENT_TEMPDIRECTORY || os.tmpdir(), 'aks-npm-'));
  let broker;
  try {
    broker = await signingBroker(process.env);
    for (const file of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(toolDir, file), path.join(npmRoot, file));
    }
    execFileSync(process.execPath, [bootstrapCli, 'ci', '--prefix', npmRoot,
      '--ignore-scripts', '--no-audit', '--no-fund'], {
      env: signingChildEnvironment(process.env),
      stdio: 'inherit',
    });
    const cli = path.join(npmRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(cli)) throw new Error(`Pinned npm CLI was not installed: ${cli}`);
    const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
    const env = { ...broker.env, npm_execpath: cli,
      // Nested lifecycle scripts invoke bare npm/node. Use the native delimiter
      // and retain the existing key casing to avoid duplicate PATH/Path on Windows.
      [pathKey]: [path.join(npmRoot, 'node_modules', '.bin'), path.dirname(process.execPath),
        process.env[pathKey] || ''].join(path.delimiter),
    };
    const actual = execFileSync(process.execPath, [cli, '--version'], {
      env: signingChildEnvironment(env),
      encoding: 'utf8',
    }).trim();
    if (actual !== version) throw new Error(`Expected npm ${version}, got ${actual}`);
    console.log(`Windows CI: verified npm ${actual}`);
    // ARM64 cannot launch on this x64 release host; native ARM64 CI covers that.
    for (const args of [
      ['ci'],
      ['run', 'build:win-ci'],
      ['run', 'test:distribution'],
      ['run', 'build:win:arm64', '--', '--reuse-prepared-assets'],
      ['run', 'test:post-build'],
    ]) {
      const needsBroker = args[0] === 'run' && args[1]?.startsWith('build:win');
      execFileSync(process.execPath, [cli, ...args], {
        env: needsBroker ? env : signingChildEnvironment(env),
        stdio: 'inherit',
      });
    }
  } finally {
    if (broker) await broker.close();
    try {
      fs.rmSync(npmRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      // Agent temp cleanup can finish later; never replace the build's result.
      console.warn(`Could not remove temporary npm directory ${npmRoot}: ${error.message}`);
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = typeof error.status === 'number' && error.status > 0 ? error.status : 1;
});
