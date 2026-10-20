import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

const packageManifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
);

test('the source package declares a consistent source revision', () => {
  const revision = packageManifest.headlampSource.revision;
  assert.match(revision, /^[0-9a-f]{40}$/);
  assert.equal(packageManifest.repository.commit, revision);
  assert.equal(packageManifest.version, `0.0.0-main.${revision.slice(0, 8)}`);
  assert.deepEqual(packageManifest.files, ['source', 'src']);
  const goMod = fs.readFileSync(path.resolve(__dirname, '..', 'source', 'backend', 'go.mod'), 'utf8');
  const goVersion =
    goMod.match(/^toolchain\s+go([^\s]+)$/m)?.[1] ?? goMod.match(/^go\s+([^\s]+)$/m)?.[1];
  assert.equal(packageManifest.headlampSource.goVersion, goVersion);
});

test('the source package exports reusable build and assembly commands', () => {
  for (const script of [
    'build',
    'build:app',
    'build:app:linux',
    'build:app:mac',
    'build:app:win',
    'build:container',
    'build:plugins-container',
    'bundle:plugins',
    'manifest:generate',
    'manifest:check',
    'smoke:app',
  ]) {
    assert.equal(typeof packageManifest.scripts[script], 'string', script);
  }
  assert.match(
    packageManifest.scripts['build:container'],
    new RegExp(`--build-arg HEADLAMP_SOURCE_COMMIT=${packageManifest.headlampSource.revision}`)
  );
  assert.match(packageManifest.scripts['build:container'], /--build-arg HEADLAMP_BUILD_MANIFEST/);
});

test('source dependency installation is an explicit consumer action', () => {
  for (const lifecycle of ['preinstall', 'install', 'postinstall']) {
    assert.equal(packageManifest.scripts[lifecycle], undefined);
  }
  assert.equal(packageManifest.scripts['install:all'], 'npm --prefix source run install:all');
});