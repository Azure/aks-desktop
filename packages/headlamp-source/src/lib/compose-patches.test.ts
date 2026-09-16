const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  applyHeadlampPatch,
  composePatchSeries,
  parsePatchSeries,
  updateHeadlampPatch,
} = require('./compose-patches.ts');

test('accepts ordered patch series gaps and suffixed entries', () => {
  assert.deepEqual(
    parsePatchSeries(
      '0002 source 0002-first-change.patch\n0002b source 0002b-follow-up.patch\n0004 package 0004-second-change.patch\n'
    ),
    [
      { file: '0002-first-change.patch', scope: 'source' },
      { file: '0002b-follow-up.patch', scope: 'source' },
      { file: '0004-second-change.patch', scope: 'package' },
    ]
  );
});

test('rejects unsafe or unordered patch series entries', () => {
  for (const series of [
    '',
    '0001 source ../0001-change.patch\n',
    '0001 source 0002-change.patch\n',
    '0001b source 0001-change.patch\n',
    '0001 source 0001-change.patch\n0001b source 0001b-follow-up.patch\n0001a source 0001a-other.patch\n',
    '0001 source 0001-change.patch\n0003 package 0003-other-change.patch\n0002 source 0002-change.patch\n',
    '0001 source 0001-change.patch\n0001 package 0001-other-change.patch\n',
  ]) {
    assert.throws(() => parsePatchSeries(series));
  }
});

test('uses Git to compose source patches for the source-bearing npm package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-compose-'));
  const packageDir = path.join(root, 'packages', 'headlamp-source');
  const patchDir = path.join(root, 'patches');
  fs.mkdirSync(path.join(packageDir, 'source', 'app'), { recursive: true });
  fs.mkdirSync(patchDir);
  fs.writeFileSync(path.join(packageDir, 'source', 'app', 'file.js'), 'old\n');
  fs.writeFileSync(path.join(patchDir, 'series'), '0001 source 0001-example-change.patch\n');
  const mailPatch = [
    'From: patch@example.invalid',
    'Subject: [PATCH] example',
    '',
    'diff --git a/app/file.js b/app/file.js',
    '--- a/app/file.js',
    '+++ b/app/file.js',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '-- ',
    '2.50.1',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(patchDir, '0001-example-change.patch'), mailPatch);

  try {
    const aggregate = composePatchSeries(root, packageDir).toString();
    assert.match(
      aggregate,
      /diff --git a\/source\/app\/file\.js b\/source\/app\/file\.js/
    );
    assert.match(aggregate, /-old\n\+new\n/);

    const gitConfig = path.join(root, 'gitconfig');
    fs.writeFileSync(gitConfig, '[diff]\n\tnoprefix = true\n\tmnemonicPrefix = true\n');
    const previousGitConfig = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    try {
      assert.equal(composePatchSeries(root, packageDir).toString(), aggregate);
    } finally {
      if (previousGitConfig === undefined) {
        delete process.env.GIT_CONFIG_GLOBAL;
      } else {
        process.env.GIT_CONFIG_GLOBAL = previousGitConfig;
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createPackageFixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-apply-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageDir = path.join(root, 'packages', 'headlamp-source');
  const installedDir = path.join(
    root,
    'node_modules',
    '@headlamp-k8s',
    'headlamp-source'
  );
  const patchDir = path.join(root, 'patches');
  const patchPath = 'patches/headlamp-source@test.patch';
  fs.mkdirSync(path.join(packageDir, 'source'), { recursive: true });
  fs.mkdirSync(path.join(installedDir, 'source'), { recursive: true });
  fs.mkdirSync(patchDir);
  fs.writeFileSync(path.join(packageDir, 'source', 'file.txt'), 'old\n');
  fs.writeFileSync(path.join(installedDir, 'source', 'file.txt'), 'old\n');
  fs.writeFileSync(path.join(patchDir, 'series'), '0001 source 0001-change.patch\n');
  fs.writeFileSync(
    path.join(patchDir, '0001-change.patch'),
    'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n'
  );
  const aggregate = composePatchSeries(root, packageDir);
  fs.writeFileSync(path.join(root, patchPath), aggregate);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      headlampPatch: {
        path: patchPath,
        integrity: `sha512-${require('node:crypto')
          .createHash('sha512')
          .update(aggregate)
          .digest('base64')}`,
      },
    })
  );
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify({
      packages: {
        'node_modules/@headlamp-k8s/headlamp-source': {},
      },
    })
  );

  return { root, packageDir, installedDir, patchDir, patchPath };
}

test('rejects unauthenticated changes in the checked-in aggregate before applying', context => {
  const { root, installedDir, patchPath } = createPackageFixture(context);
  fs.appendFileSync(path.join(root, patchPath),
    'diff --git a/extra.txt b/extra.txt\nnew file mode 100644\n--- /dev/null\n+++ b/extra.txt\n@@ -0,0 +1 @@\n+untrusted\n');
  assert.throws(() => applyHeadlampPatch(root, installedDir), /authenticated aggregate/);
  assert.equal(fs.readFileSync(path.join(installedDir, 'source/file.txt'), 'utf8'), 'old\n');
  assert.equal(fs.existsSync(path.join(installedDir, 'extra.txt')), false);
  assert.equal(fs.existsSync(path.join(installedDir, '.headlamp-patch-integrity')), false);
});

test('reinstalls an exact patched copy after a build modifies source files', context => {
  const { root, installedDir } = createPackageFixture(context);
  assert.equal(applyHeadlampPatch(root, installedDir), true);
  assert.equal(
    fs.readFileSync(path.join(installedDir, 'source', 'file.txt'), 'utf8'),
    'new\n'
  );
  assert.equal(applyHeadlampPatch(root, installedDir), false);

  const cache = path.join(installedDir, 'node_modules', 'dependency', 'index.js');
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, 'dependency cache');
  fs.writeFileSync(path.join(installedDir, 'source', 'file.txt'), 'generated translation\n');
  assert.equal(applyHeadlampPatch(root, installedDir), true);
  assert.equal(fs.readFileSync(path.join(installedDir, 'source', 'file.txt'), 'utf8'), 'new\n');
  assert.equal(fs.readFileSync(cache, 'utf8'), 'dependency cache');
  assert.equal(applyHeadlampPatch(root, installedDir), false);
});

test('removes retired patch files even when remaining patched files are unchanged', context => {
  const { root, patchDir, installedDir } = createPackageFixture(context);
  const numberedPatch = path.join(patchDir, '0001-change.patch');
  fs.appendFileSync(numberedPatch,
    'diff --git a/retired.txt b/retired.txt\nnew file mode 100644\n--- /dev/null\n+++ b/retired.txt\n@@ -0,0 +1 @@\n+retired\n');
  updateHeadlampPatch(root);
  applyHeadlampPatch(root, installedDir);
  const cache = path.join(installedDir, 'source', 'frontend', 'node_modules', 'cache.txt');
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, 'old source dependencies');
  fs.writeFileSync(numberedPatch,
    'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n');
  updateHeadlampPatch(root);
  assert.equal(applyHeadlampPatch(root, installedDir), true);
  assert.equal(fs.readFileSync(path.join(installedDir, 'source', 'file.txt'), 'utf8'), 'new\n');
  assert.equal(fs.existsSync(path.join(installedDir, 'source', 'retired.txt')), false);
  assert.equal(fs.existsSync(cache), false);
});

test('recovers an interrupted application from verified base source', context => {
  const { root, packageDir, installedDir, patchDir } = createPackageFixture(context);
  for (const directory of [packageDir, installedDir]) {
    fs.writeFileSync(path.join(directory, 'source', 'other.txt'), 'old\n');
  }
  fs.appendFileSync(path.join(patchDir, '0001-change.patch'),
    'diff --git a/other.txt b/other.txt\n--- a/other.txt\n+++ b/other.txt\n@@ -1 +1 @@\n-old\n+new\n');
  updateHeadlampPatch(root);
  fs.writeFileSync(path.join(installedDir, 'source', 'file.txt'), 'new\n');
  assert.equal(applyHeadlampPatch(root, installedDir), true);
  assert.equal(fs.readFileSync(path.join(installedDir, 'source', 'other.txt'), 'utf8'), 'new\n');
});

test('rejects a symlinked installation instead of patching the maintained source', context => {
  const { root, packageDir, installedDir } = createPackageFixture(context);
  fs.rmSync(installedDir, { recursive: true });
  fs.symlinkSync(packageDir, installedDir, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => applyHeadlampPatch(root, installedDir), /separate copied source package/);
  assert.equal(fs.readFileSync(path.join(packageDir, 'source', 'file.txt'), 'utf8'), 'old\n');
});

test('does not replace installed files when patch integrity or base validation fails', context => {
  const { root, packageDir, installedDir } = createPackageFixture(context);
  applyHeadlampPatch(root, installedDir);
  const installedFile = path.join(installedDir, 'source', 'file.txt');
  fs.writeFileSync(installedFile, 'generated\n');
  fs.writeFileSync(path.join(packageDir, 'source', 'file.txt'), 'untrusted source\n');
  assert.throws(() => applyHeadlampPatch(root, installedDir), /git apply.*failed/);
  assert.equal(fs.readFileSync(installedFile, 'utf8'), 'generated\n');
  fs.writeFileSync(path.join(packageDir, 'source', 'file.txt'), 'old\n');
  const manifestPath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.headlampPatch.integrity = 'sha512-invalid';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => applyHeadlampPatch(root, installedDir), /patch integrity/);
  assert.equal(fs.readFileSync(installedFile, 'utf8'), 'generated\n');
});

test('restores the original installed package if replacement cannot be renamed', context => {
  const { root, installedDir } = createPackageFixture(context);
  applyHeadlampPatch(root, installedDir);
  const installedFile = path.join(installedDir, 'source', 'file.txt');
  fs.writeFileSync(installedFile, 'generated\n');
  const rename = fs.renameSync;
  context.mock.method(fs, 'renameSync', (source, destination) => {
    if (path.basename(source) === 'package' && destination === installedDir) {
      throw new Error('replacement blocked');
    }
    return rename(source, destination);
  });
  assert.throws(() => applyHeadlampPatch(root, installedDir), /replacement blocked/);
  assert.equal(fs.readFileSync(installedFile, 'utf8'), 'generated\n');
  assert.ok(!fs.readdirSync(path.dirname(installedDir)).some(name => name.startsWith('.headlamp-install-')));
});
