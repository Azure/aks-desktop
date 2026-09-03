const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  prepareHeadlampSource,
  removeAzureArtifactsResolutions,
  sourceVersion,
  updateHeadlampSource,
  validateTrackedSourcePath,
} = require('./update-source.ts');
const { composePatchSeries } = require('./compose-patches.ts');

const tempDirs = [];

afterEach(() => {
  tempDirs.splice(0).forEach(directory =>
    fs.rmSync(directory, { recursive: true, force: true })
  );
});

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createSourceCheckout() {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-checkout-'));
  tempDirs.push(sourceDir);
  run('git', ['init', '-q', '-b', 'main'], sourceDir);
  run('git', ['config', 'user.name', 'Headlamp test'], sourceDir);
  run('git', ['config', 'user.email', 'headlamp@example.invalid'], sourceDir);
  for (const directory of ['app', 'backend', 'frontend']) {
    fs.mkdirSync(path.join(sourceDir, directory));
    fs.writeFileSync(path.join(sourceDir, directory, '.keep'), '');
  }
  for (const [file, contents] of [
    ['.gitignore', 'node_modules/\n'],
    ['package.json', '{"name":"headlamp-root","private":true}\n'],
    ['LICENSE', 'license\n'],
    ['README.md', 'readme\n'],
    ['Dockerfile', 'FROM scratch\n'],
  ]) {
    fs.writeFileSync(path.join(sourceDir, file), contents);
  }
  run('git', ['add', '.'], sourceDir);
  run('git', ['commit', '-qm', 'source'], sourceDir);
  fs.writeFileSync(path.join(sourceDir, 'untracked.txt'), 'exclude me');
  return {
    commit: run('git', ['rev-parse', 'HEAD'], sourceDir),
    sourceDir,
  };
}

function createProject(commit) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-project-'));
  tempDirs.push(rootDir);
  const packageDir = path.join(rootDir, 'packages', 'headlamp-source');
  fs.mkdirSync(path.join(packageDir, 'source'), { recursive: true });
  for (const directory of ['app', 'backend', 'frontend']) {
    fs.mkdirSync(path.join(packageDir, 'source', directory));
    fs.writeFileSync(path.join(packageDir, 'source', directory, '.keep'), '');
  }
  for (const [file, contents] of [
    ['package.json', '{"name":"headlamp-root","private":true}\n'],
    ['LICENSE', 'license\n'],
    ['README.md', 'readme\n'],
    ['Dockerfile', 'FROM scratch\n'],
  ]) {
    fs.writeFileSync(path.join(packageDir, 'source', file), contents);
  }
  fs.mkdirSync(path.join(rootDir, 'patches'));
  const version = `0.0.0-main.${commit.slice(0, 8)}`;
  const patchPath = `patches/headlamp-source@${version}.patch`;
  fs.writeFileSync(path.join(rootDir, 'patches', 'series'), '0001 source 0001-readme.patch\n');
  fs.writeFileSync(
    path.join(rootDir, 'patches', '0001-readme.patch'),
    `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-readme
+patched readme
`
  );
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@headlamp-k8s/headlamp-source',
        version,
        license: 'Apache-2.0',
        repository: {
          type: 'git',
          url: 'https://github.com/kubernetes-sigs/headlamp.git',
          commit,
        },
        engines: { node: '>=22.22.2', npm: '>=12.0.0' },
        dependencies: { tsx: '4.23.1' },
        scripts: {
          'build:container': 'old',
          'build:plugins-container': 'old',
        },
        headlampSource: { revision: commit },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'test-project',
        version: '1.0.0',
        private: true,
        headlampSource: { revision: commit },
        devDependencies: { '@headlamp-k8s/headlamp-source': version },
        patchedDependencies: {
          [`@headlamp-k8s/headlamp-source@${version}`]: patchPath,
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(rootDir, 'package-lock.json'),
    `${JSON.stringify(
      {
        name: 'test-project',
        version: '1.0.0',
        lockfileVersion: 4,
        requires: true,
        packages: {
          '': {
            name: 'test-project',
            version: '1.0.0',
            devDependencies: { '@headlamp-k8s/headlamp-source': version },
          },
          'node_modules/@headlamp-k8s/headlamp-source': {
            patched: {
              path: patchPath,
              integrity: `sha512-${createHash('sha512')
                .update(composePatchSeries(rootDir, packageDir))
                .digest('base64')}`,
            },
          },
        },
      },
      null,
      2
    )}\n`
  );
  return { packageDir, patchPath, rootDir };
}

test('derives versions from a revision', () => {
  const commit = 'a'.repeat(40);

  assert.equal(sourceVersion({ revision: commit }), '0.0.0-main.aaaaaaaa');
  assert.throws(() => sourceVersion({ revision: 'main' }), /revision/);
  assert.throws(
    () => sourceVersion({ revision: commit, ref: 'refs/heads/main' } as any),
    /only revision/
  );
  assert.throws(
    () => sourceVersion({ commit } as any),
    /only revision/
  );
  assert.throws(
    () => sourceVersion({ revision: 123 } as any),
    /revision must be a string/
  );
  assert.throws(
    () => sourceVersion(null as any),
    /only revision/
  );
});

test('removes verified Azure Artifacts mirror resolutions from npm lockfiles', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-lockfile-'));
  tempDirs.push(directory);
  const lockFile = path.join(directory, 'package-lock.json');
  fs.writeFileSync(
    lockFile,
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          'node_modules/mirrored': {
            version: '1.2.3',
            resolved:
              'https://ms-feed-12.pkgs.visualstudio.com/feed/npm/registry/mirrored/-/mirrored-1.2.3.tgz',
            integrity: 'sha512-verified',
          },
          'node_modules/public': {
            version: '4.5.6',
            resolved: 'https://registry.npmjs.org/public/-/public-4.5.6.tgz',
            integrity: 'sha512-public',
          },
          'node_modules/unverified': {
            version: '7.8.9',
            resolved:
              'https://ms-feed-12.pkgs.visualstudio.com/feed/npm/registry/unverified/-/unverified-7.8.9.tgz',
          },
        },
      },
      null,
      2
    )}\n`
  );

  assert.equal(removeAzureArtifactsResolutions(lockFile), 1);
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  assert.equal(lock.packages['node_modules/mirrored'].resolved, undefined);
  assert.match(lock.packages['node_modules/public'].resolved, /^https:\/\/registry\.npmjs\.org\//);
  assert.match(
    lock.packages['node_modules/unverified'].resolved,
    /\.pkgs\.visualstudio\.com\//
  );
});

test('updates an unpacked source package from a clean exact commit', () => {
  const { commit, sourceDir } = createSourceCheckout();
  const { packageDir, rootDir } = createProject(commit);
  run('git', ['commit', '--allow-empty', '-qm', 'next source'], sourceDir);
  const nextCommit = run('git', ['rev-parse', 'HEAD'], sourceDir);

  const result = updateHeadlampSource({
    rootDir,
    packageDir,
    sourceDir,
    revision: nextCommit,
  });
  const project = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  const packageManifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')
  );
  const version = sourceVersion(project.headlampSource);

  assert.equal(result.packageDir, packageDir);
  assert.equal(packageManifest.version, version);
  assert.deepEqual(project.headlampSource, { revision: nextCommit });
  assert.deepEqual(packageManifest.headlampSource, { revision: nextCommit });
  assert.equal(project.devDependencies['@headlamp-k8s/headlamp-source'], version);
  assert.equal(fs.existsSync(path.join(packageDir, 'source', 'Dockerfile')), true);
  assert.equal(
    fs.readFileSync(path.join(packageDir, '.source-commit'), 'utf8').trim(),
    nextCommit
  );
  assert.match(
    fs.readFileSync(result.patchPath, 'utf8'),
    /diff --git a\/source\/README\.md b\/source\/README\.md/
  );
  assert.equal(fs.existsSync(path.join(packageDir, 'source', 'untracked.txt')), false);
  assert.equal(
    lock.packages['node_modules/@headlamp-k8s/headlamp-source'].resolved,
    'file:packages/headlamp-source'
  );
  assert.equal(
    'integrity' in lock.packages['node_modules/@headlamp-k8s/headlamp-source'],
    false
  );
  assert.deepEqual(
    lock.packages['node_modules/@headlamp-k8s/headlamp-source'].dependencies,
    { tsx: '4.23.1' }
  );
  assert.match(
    lock.packages['node_modules/@headlamp-k8s/headlamp-source'].patched.integrity,
    /^sha512-/
  );
});

test('materializes the configured commit without tracking upstream source', () => {
  const { commit, sourceDir } = createSourceCheckout();
  const { packageDir, patchPath, rootDir } = createProject(commit);
  fs.rmSync(path.join(packageDir, 'source'), { recursive: true });

  assert.deepEqual(prepareHeadlampSource({ rootDir, packageDir, sourceDir }), {
    packageDir,
    prepared: true,
  });
  assert.equal(fs.existsSync(path.join(packageDir, 'source', 'Dockerfile')), true);
  assert.equal(
    fs.readFileSync(path.join(packageDir, '.source-commit'), 'utf8').trim(),
    commit
  );
  assert.equal(fs.existsSync(path.join(rootDir, patchPath)), true);
  assert.deepEqual(prepareHeadlampSource({ rootDir, packageDir, sourceDir }), {
    packageDir,
    prepared: false,
  });
});

test('rematerializes source when an authoritative file is modified', () => {
  const { commit, sourceDir } = createSourceCheckout();
  const { packageDir, rootDir } = createProject(commit);
  fs.rmSync(path.join(packageDir, 'source'), { recursive: true });
  prepareHeadlampSource({ rootDir, packageDir, sourceDir });
  fs.writeFileSync(path.join(packageDir, 'source', 'README.md'), 'unreviewed change\n');

  assert.deepEqual(prepareHeadlampSource({ rootDir, packageDir, sourceDir }), {
    packageDir,
    prepared: true,
  });
  assert.equal(fs.readFileSync(path.join(packageDir, 'source', 'README.md'), 'utf8'), 'readme\n');
});

test('keeps materialized source when only ignored generated files are added', () => {
  const { commit, sourceDir } = createSourceCheckout();
  const { packageDir, rootDir } = createProject(commit);
  fs.rmSync(path.join(packageDir, 'source'), { recursive: true });
  prepareHeadlampSource({ rootDir, packageDir, sourceDir });
  const generatedDirectory = path.join(packageDir, 'source', 'node_modules', 'generated');
  fs.mkdirSync(generatedDirectory, { recursive: true });
  fs.writeFileSync(path.join(generatedDirectory, 'index.js'), 'generated\n');

  assert.deepEqual(prepareHeadlampSource({ rootDir, packageDir, sourceDir }), {
    packageDir,
    prepared: false,
  });
});

test('rejects a generated aggregate that differs from the lockfile', () => {
  const { commit, sourceDir } = createSourceCheckout();
  const { packageDir, patchPath, rootDir } = createProject(commit);
  const lockPath = path.join(rootDir, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.packages[
    'node_modules/@headlamp-k8s/headlamp-source'
  ].patched.integrity = 'sha512-invalid';
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  fs.rmSync(path.join(packageDir, 'source'), { recursive: true });

  assert.throws(
    () => prepareHeadlampSource({ rootDir, packageDir, sourceDir }),
    /patch lock integrity/
  );
  assert.equal(fs.existsSync(path.join(rootDir, patchPath)), false);
});

test('replaces an invalid generated source marker', () => {
  const { commit, sourceDir } = createSourceCheckout();
  const { packageDir, rootDir } = createProject(commit);
  fs.mkdirSync(path.join(packageDir, '.source-commit'));

  assert.deepEqual(
    prepareHeadlampSource({ rootDir, packageDir, sourceDir }),
    {
      packageDir,
      prepared: true,
    }
  );
  assert.equal(
    fs.readFileSync(path.join(packageDir, '.source-commit'), 'utf8').trim(),
    commit
  );
});

test('rejects a checkout that does not match the configured commit', () => {
  const { commit, sourceDir } = createSourceCheckout();
  const { packageDir, rootDir } = createProject(commit);
  const otherCommit = `${commit.startsWith('a') ? 'b' : 'a'}${commit.slice(1)}`;
  assert.throws(
    () =>
      updateHeadlampSource({
        rootDir,
        packageDir,
        sourceDir,
        revision: otherCommit,
      }),
    /does not match/
  );
});

test('rejects source paths that escape on POSIX or Windows', () => {
  for (const unsafePath of ['../outside', '..\\outside', '/absolute', 'C:\\absolute']) {
    assert.throws(() => validateTrackedSourcePath(unsafePath), /Unsafe Headlamp source path/);
  }
  assert.doesNotThrow(() => validateTrackedSourcePath('frontend/src/index.ts'));
});

test('rejects tracked symbolic links', () => {
  const { sourceDir } = createSourceCheckout();
  fs.symlinkSync('Dockerfile', path.join(sourceDir, 'Dockerfile.link'));
  run('git', ['add', 'Dockerfile.link'], sourceDir);
  run('git', ['commit', '-qm', 'add symlink'], sourceDir);
  const commit = run('git', ['rev-parse', 'HEAD'], sourceDir);
  const { packageDir, rootDir } = createProject(commit);

  assert.throws(
    () => updateHeadlampSource({ rootDir, packageDir, sourceDir }),
    /tracked symbolic link/
  );
});
