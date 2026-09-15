const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  fetchHtmlWithin,
  packagedExecutableCandidates,
  resolvePackagedExecutable,
  reserveReadinessPort,
  smoke,
} = require('./smoke-app.ts');

test('reports a signal-terminated app before the readiness timeout', { skip: process.platform === 'win32' }, async context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-smoke-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'app');
  fs.writeFileSync(executable, '#!/bin/sh\nkill -TERM $$\n', { mode: 0o755 });
  await assert.rejects(smoke(executable, 0, 3000, false), /exited before becoming ready \(SIGTERM\)/);
});

test('resolves the recorded Windows target without falling back to a stale host bundle', t => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-smoke-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  const manifest = { product: { productName: 'example' } };
  const armExecutable = path.join(dist, 'win-arm64-unpacked', 'example.exe');
  for (const directory of ['win-unpacked', 'win-arm64-unpacked']) {
    fs.mkdirSync(path.join(dist, directory));
    fs.writeFileSync(path.join(dist, directory, 'example.exe'), 'fixture');
  }
  const marker = path.join(dist, '.package-target.json');
  fs.writeFileSync(marker, JSON.stringify({ platform: 'win32', arch: 'arm64' }));
  assert.equal(resolvePackagedExecutable(dist, manifest, 'win32', 'x64'), armExecutable);
  fs.rmSync(armExecutable);
  assert.throws(() => resolvePackagedExecutable(dist, manifest, 'win32', 'x64'), /not found/);
  fs.writeFileSync(marker, JSON.stringify({ platform: 'linux', arch: 'arm64' }));
  assert.throws(() => resolvePackagedExecutable(dist, manifest, 'win32', 'x64'), /Invalid package target/);
  fs.rmSync(marker);
  assert.equal(
    resolvePackagedExecutable(dist, manifest, 'win32', 'x64'),
    path.join(dist, 'win-unpacked', 'example.exe')
  );
});

test('uses the configured macOS executable name for the app bundle and binary', () => {
  const manifest = {
    product: { name: 'example-desktop', productName: 'Example Desktop' },
    platforms: { mac: { executableName: 'example-desktop' } },
  };

  const dist = path.resolve('dist');
  const candidates = packagedExecutableCandidates(dist, manifest, 'darwin', 'arm64');

  assert.equal(
    candidates[0],
    path.join(dist, 'mac-arm64', 'example-desktop.app', 'Contents', 'MacOS', 'example-desktop'),
  );
});

for (const platform of ['darwin', 'linux']) {
  for (const architecture of ['x64', 'arm64']) {
    test(`resolves the recorded ${platform}/${architecture} target without a stale fallback`, t => {
      const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'target-smoke-'));
      t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
      const manifest = { product: { productName: 'example' } };
      const binary = platform === 'darwin'
        ? path.join('example.app', 'Contents', 'MacOS', 'example') : 'example';
      const directories = platform === 'darwin'
        ? ['mac', 'mac-x64', 'mac-arm64', 'mac-universal']
        : ['linux-unpacked', 'linux-x64-unpacked', 'linux-arm64-unpacked'];
      for (const directory of directories) {
        const executable = path.join(dist, directory, binary);
        fs.mkdirSync(path.dirname(executable), { recursive: true });
        fs.writeFileSync(executable, 'fixture');
      }
      fs.writeFileSync(path.join(dist, '.package-target.json'),
        JSON.stringify({ platform, arch: architecture }));
      const requestedDirectory = platform === 'darwin'
        ? `mac-${architecture}` : `linux-${architecture}-unpacked`;
      const requested = path.join(dist, requestedDirectory, binary);
      const otherArchitecture = architecture === 'x64' ? 'arm64' : 'x64';
      assert.equal(resolvePackagedExecutable(dist, manifest, platform, otherArchitecture), requested);
      fs.rmSync(requested);
      if (platform === 'darwin') {
        const universal = path.join(dist, 'mac-universal', binary);
        assert.equal(resolvePackagedExecutable(dist, manifest, platform, otherArchitecture), universal);
        fs.rmSync(universal);
      }
      if (architecture === 'x64') {
        const legacy = path.join(dist, platform === 'darwin' ? 'mac' : 'linux-unpacked', binary);
        assert.equal(resolvePackagedExecutable(dist, manifest, platform, otherArchitecture), legacy);
        fs.rmSync(legacy);
      }
      assert.throws(() => resolvePackagedExecutable(dist, manifest, platform, otherArchitecture), /not found/);
    });
  }
}

test('reserves an available readiness port exclusively', async () => {
  const first: any = await reserveReadinessPort();
  try {
    await assert.rejects(reserveReadinessPort(first.port), error => {
      return error && error.code === 'EADDRINUSE';
    });
  } finally {
    await first.release();
  }

  const second: any = await reserveReadinessPort(first.port);
  await second.release();
});

test('aborts an HTTP probe that does not respond', async () => {
  const fetchFn = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });

  await assert.rejects(fetchHtmlWithin('http://127.0.0.1:4466', 5, fetchFn), error => {
    return error?.name === 'AbortError';
  });
});
