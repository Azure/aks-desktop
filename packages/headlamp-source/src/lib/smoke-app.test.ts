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
} = require('./smoke-app.ts');

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
    product: { name: 'aks-desktop', productName: 'AKS Desktop' },
    platforms: { mac: { executableName: 'aks-desktop' } },
  };

  const dist = path.resolve('dist');
  const candidates = packagedExecutableCandidates(dist, manifest, 'darwin', 'arm64');

  assert.equal(
    candidates[0],
    path.join(dist, 'mac-arm64', 'aks-desktop.app', 'Contents', 'MacOS', 'aks-desktop'),
  );
});

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
