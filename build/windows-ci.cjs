// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Run through npm run ci:windows so npm_execpath identifies the working bootstrap CLI.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main() {
  const { packageManager } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const version = /^npm@(\d+\.\d+\.\d+)$/.exec(packageManager || '')?.[1];
  if (!version) throw new Error('Windows CI requires an exact npm version in packageManager');
  const bootstrapCli = process.env.npm_execpath;
  if (!bootstrapCli || !fs.existsSync(bootstrapCli)) {
    throw new Error('Missing npm_execpath; invoke through npm run ci:windows');
  }

  // Keep npm outside the checkout: npm ci removes the checkout's node_modules.
  // Node creates native Windows paths; none pass through MSYS conversion or Bash PATH.
  const npmRoot = fs.mkdtempSync(path.join(process.env.AGENT_TEMPDIRECTORY || os.tmpdir(), 'aks-npm-'));
  try {
    execFileSync(process.execPath, [bootstrapCli, 'install', '--prefix', npmRoot,
      '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', packageManager], { stdio: 'inherit' });
    const cli = path.join(npmRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(cli)) throw new Error(`Pinned npm CLI was not installed: ${cli}`);
    const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
    const env = { ...process.env, npm_execpath: cli,
      // Nested lifecycle scripts invoke bare npm/node. Use the native delimiter
      // and retain the existing key casing to avoid duplicate PATH/Path on Windows.
      [pathKey]: [path.join(npmRoot, 'node_modules', '.bin'), path.dirname(process.execPath),
        process.env[pathKey] || ''].join(path.delimiter),
    };
    const actual = execFileSync(process.execPath, [cli, '--version'], { env, encoding: 'utf8' }).trim();
    if (actual !== version) throw new Error(`Expected npm ${version}, got ${actual}`);
    console.log(`Windows CI: verified npm ${actual}`);
    for (const args of [['ci'], ['run', 'build:win-ci'], ['run', 'test:distribution']]) {
      execFileSync(process.execPath, [cli, ...args], { env, stdio: 'inherit' });
    }
  } finally {
    try {
      fs.rmSync(npmRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      // Agent temp cleanup can finish later; never replace the build's result.
      console.warn(`Could not remove temporary npm directory ${npmRoot}: ${error.message}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = typeof error.status === 'number' && error.status > 0 ? error.status : 1;
}
