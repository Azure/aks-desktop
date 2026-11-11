// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function command(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', ...options });
}

function verifyApp(app, run = command) {
  run('codesign', ['--verify', '--deep', '--strict', app]);
  const name = path.basename(app, '.app');
  const bundles = [
    app,
    ...['', ' (GPU)', ' (Plugin)', ' (Renderer)'].map(suffix =>
      path.join(app, 'Contents', 'Frameworks', `${name} Helper${suffix}.app`)
    ),
  ];
  for (const bundle of bundles) {
    if (!fs.statSync(bundle).isDirectory()) {
      throw new Error(`Missing Electron application bundle: ${bundle}`);
    }
    const xml = run('codesign', ['--display', '--entitlements', '-', '--xml', bundle]);
    if (!xml.trim()) {
      throw new Error(`Missing signing entitlements: ${bundle}`);
    }
    const entitlements = JSON.parse(
      run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml })
    );
    if (entitlements['com.apple.security.cs.allow-jit'] !== true) {
      throw new Error(`Missing com.apple.security.cs.allow-jit=true: ${bundle}`);
    }
  }
}

function verifyDirectory(directory, run = command) {
  const images = fs.readdirSync(directory).filter(name => name.endsWith('.dmg'));
  if (images.length === 0) {
    throw new Error(`No DMGs found in ${directory}`);
  }
  for (const image of images) {
    const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-desktop-signing-'));
    let attached = false;
    try {
      run('hdiutil', [
        'attach', '-readonly', '-nobrowse', '-noautoopen',
        '-mountpoint', mount, path.resolve(directory, image),
      ]);
      attached = true;
      const apps = fs.readdirSync(mount).filter(name => name.endsWith('.app'));
      if (apps.length !== 1) {
        throw new Error(`Expected exactly one app in ${image}; found ${apps.length}`);
      }
      verifyApp(path.join(mount, apps[0]), run);
      console.log(`Verified code signatures and Electron JIT entitlements: ${image}`);
    } finally {
      if (attached) {
        run('hdiutil', ['detach', mount]);
      }
      fs.rmdirSync(mount);
    }
  }
}

if (require.main === module) {
  try {
    if (process.platform !== 'darwin' || process.argv.length !== 3) {
      throw new Error('Usage on macOS: node build/verify-macos-signing.cjs <dmg-directory>');
    }
    verifyDirectory(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { verifyApp, verifyDirectory };
