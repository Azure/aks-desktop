const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  fetchHtmlWithin,
  packagedExecutableCandidates,
  reserveReadinessPort,
} = require('./smoke-app.ts');

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
