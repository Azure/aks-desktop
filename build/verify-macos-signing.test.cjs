// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { verifyApp, verifyDirectory } = require('./verify-macos-signing.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-signing-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'AKS desktop.app');
  const bundles = [
    app,
    ...['', ' (GPU)', ' (Plugin)', ' (Renderer)'].map(suffix =>
      path.join(app, 'Contents', 'Frameworks', `AKS desktop Helper${suffix}.app`)
    ),
  ];
  for (const bundle of bundles) fs.mkdirSync(bundle, { recursive: true });
  return { root, app, bundles };
}

function signingCommands(overrides = {}) {
  return (command, args, options) => {
    if (command === 'codesign' && args[0] === '--verify') return '';
    if (command === 'codesign' && args[0] === '--display') {
      return JSON.stringify({
        'com.apple.security.cs.allow-jit': true,
        ...overrides[args.at(-1)],
      });
    }
    if (command === 'plutil') return options.input;
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
}

test('validates the main app and all four Electron helpers', t => {
  const { app } = fixture(t);
  verifyApp(app, signingCommands());
});

for (const index of [0, 1, 2, 3, 4]) {
  test(`rejects missing or false JIT entitlement on bundle ${index}`, t => {
    const { app, bundles } = fixture(t);
    for (const value of [undefined, false, 'true']) {
      assert.throws(() => verifyApp(app, signingCommands({
        [bundles[index]]: { 'com.apple.security.cs.allow-jit': value },
      })), /Missing com.apple.security.cs.allow-jit=true/);
    }
  });
}

test('rejects absent entitlements and invalid code signatures', t => {
  const { app } = fixture(t);
  assert.throws(() => verifyApp(app, (command, args) => {
    if (args[0] === '--verify') return '';
    return '';
  }), /Missing signing entitlements/);
  assert.throws(() => verifyApp(app, () => {
    throw new Error('invalid signature');
  }), /invalid signature/);
});

test('rejects missing helpers and empty artifact directories', t => {
  const { app, root, bundles } = fixture(t);
  fs.rmdirSync(bundles[4]);
  assert.throws(() => verifyApp(app, signingCommands()), /ENOENT/);
  assert.throws(() => verifyDirectory(root), /No DMGs found/);
});

test('unmounts even when an image contains no app', t => {
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, 'candidate.dmg'), '');
  const calls = [];
  assert.throws(() => verifyDirectory(root, (command, args) => {
    calls.push([command, args]);
    return '';
  }), /Expected exactly one app/);
  assert.equal(calls[0][1][0], 'attach');
  assert.ok(calls[0][1].includes('-readonly'));
  assert.equal(calls[1][1][0], 'detach');
  assert.equal(fs.existsSync(calls[1][1][1]), false);
});

for (const missingJit of [false, true]) {
  test(`checks mounted app entitlements and always unmounts (missing JIT: ${missingJit})`, t => {
    const { root } = fixture(t);
    fs.writeFileSync(path.join(root, 'candidate.dmg'), '');
    let mount;
    let detached = false;
    const run = (command, args, options) => {
      if (command === 'hdiutil' && args[0] === 'attach') {
        mount = args[args.indexOf('-mountpoint') + 1];
        const app = path.join(mount, 'AKS desktop.app');
        fs.mkdirSync(app);
        for (const suffix of ['', ' (GPU)', ' (Plugin)', ' (Renderer)']) {
          fs.mkdirSync(path.join(app, 'Contents', 'Frameworks',
            `AKS desktop Helper${suffix}.app`), { recursive: true });
        }
        return '';
      }
      if (command === 'hdiutil' && args[0] === 'detach') {
        assert.equal(args[1], mount);
        detached = true;
        fs.rmSync(path.join(mount, 'AKS desktop.app'), { recursive: true });
        return '';
      }
      if (missingJit && command === 'codesign' && args[0] === '--display') {
        return '{}';
      }
      return signingCommands()(command, args, options);
    };
    if (missingJit) {
      assert.throws(() => verifyDirectory(root, run), /Missing com.apple.security.cs.allow-jit/);
    } else {
      verifyDirectory(root, run);
    }
    assert.equal(detached, true);
    assert.equal(fs.existsSync(mount), false);
  });
}

test('native codesign preserves JIT entitlements when replacing a signature', {
  skip: process.platform !== 'darwin',
}, t => {
  const { root } = fixture(t);
  const binary = path.join(root, 'test-binary');
  const plist = path.join(root, 'entitlements.plist');
  fs.copyFileSync('/usr/bin/true', binary);
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
</dict></plist>`);
  execFileSync('codesign', ['--force', '--sign', '-', '--options=runtime',
    '--entitlements', plist, binary]);
  execFileSync('codesign', ['--force', '--sign', '-', '--options=runtime',
    '--preserve-metadata=entitlements', binary]);
  const xml = execFileSync('codesign', ['--display', '--entitlements', '-', '--xml', binary]);
  const entitlements = JSON.parse(execFileSync('plutil',
    ['-convert', 'json', '-o', '-', '-'], { input: xml, encoding: 'utf8' }));
  assert.equal(entitlements['com.apple.security.cs.allow-jit'], true);
});

test('both release architectures preserve entitlements and verify signed artifacts', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', '1es-pipeline-mac.yml'), 'utf8'
  );
  assert.equal(workflow.match(/--options=runtime --preserve-metadata=entitlements/g)?.length, 2);
  assert.doesNotMatch(workflow, /node build\/verify-macos-signing\.cjs "\$\(Pipeline.Workspace\)\/unsigned-dmg"/);
  assert.equal(workflow.match(/node build\/verify-macos-signing\.cjs "\$\(Pipeline.Workspace\)\/signed-dmg"/g)?.length, 2);
  assert.equal(workflow.match(/node build\/verify-macos-signing\.cjs "\$\(Pipeline.Workspace\)\/notarized-dmg"/g)?.length, 2);
  for (const arch of ['arm64', 'x64']) {
    const sign = workflow.slice(workflow.indexOf(`- stage: Sign_${arch}`),
      workflow.indexOf(`- stage: Notarize_${arch}`));
    const operation = sign.indexOf('"OperationCode": "MacAppDeveloperSign"');
    const after = sign.indexOf('node build/verify-macos-signing.cjs "$(Pipeline.Workspace)/signed-dmg"');
    assert.ok(operation > 0 && after > operation);
    assert.match(sign, /checkout: self/);
  }
});
