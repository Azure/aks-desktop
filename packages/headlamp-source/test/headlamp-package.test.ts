import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(PACKAGE_DIR, '..', '..');
const {
  packageDir: HEADLAMP_PACKAGE_DIR,
  sourceDir: HEADLAMP_SOURCE_DIR,
} = require('../scripts/paths.ts').resolveInstalledHeadlampPaths(ROOT_DIR);

const { composePatchSeries } = require(
  path.join(PACKAGE_DIR, 'scripts', 'compose-patches.ts')
);
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(HEADLAMP_PACKAGE_DIR, 'package.json'), 'utf8')
);
const rootManifest = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'package-lock.json'), 'utf8')
);
const VERSION = `0.0.0-main.${rootManifest.headlampSource.commit.slice(0, 8)}`;
const { packagedExecutableCandidates } = require(
  path.join(HEADLAMP_PACKAGE_DIR, 'scripts', 'smoke-app.ts')
);

test('the installed package is a complete pinned source distribution', () => {
  assert.equal(fs.lstatSync(HEADLAMP_PACKAGE_DIR).isSymbolicLink(), false);
  assert.equal(packageManifest.name, '@headlamp-k8s/headlamp-source');
  assert.equal(packageManifest.version, VERSION);
  assert.deepEqual(packageManifest.files, ['source', 'scripts']);
  assert.equal(
    packageManifest.repository.url,
    rootManifest.headlampSource.repository
  );
  assert.equal(packageManifest.headlampSource.baseTag, undefined);
  assert.equal(
    packageManifest.headlampSource.commit,
    rootManifest.headlampSource.commit
  );
  for (const file of [
    'package.json',
    'Dockerfile',
    'Dockerfile.plugins',
    'backend/go.mod',
    'frontend/package-lock.json',
    'app/package-lock.json',
  ]) {
    assert.equal(fs.statSync(path.join(HEADLAMP_SOURCE_DIR, file)).isFile(), true);
  }
});

test('upstream Headlamp source is materialized instead of tracked', () => {
  const result = spawnSync(
    'git',
    ['ls-files', 'packages/headlamp-source/source'],
    { cwd: ROOT_DIR, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '');
});

test('npm owns and verifies the Headlamp patch', () => {
  const selector = `@headlamp-k8s/headlamp-source@${VERSION}`;
  const patchPath = `patches/headlamp-source@${VERSION}.patch`;
  assert.equal(rootManifest.patchedDependencies[selector], patchPath);
  const lockEntry =
    packageLock.packages['node_modules/@headlamp-k8s/headlamp-source'];
  assert.equal(lockEntry.version, VERSION);
  assert.equal(lockEntry.patched.path, patchPath);
  assert.match(lockEntry.patched.integrity, /^sha512-/);
  assert.equal(
    fs
      .readFileSync(path.join(ROOT_DIR, patchPath))
      .equals(composePatchSeries(ROOT_DIR)),
    true
  );
  assert.equal(
    fs.statSync(
      path.join(HEADLAMP_SOURCE_DIR, 'app', 'scripts', 'build-manifest.ts')
    ).isFile(),
    true
  );
});

test('the source package exports app and container build scripts', () => {
  assert.equal(packageManifest.dependencies.tsx, '4.23.1');
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
    assert.equal(typeof packageManifest.scripts[script], 'string');
  }
  assert.match(
    rootManifest.scripts['test:distribution'],
    /npm run headlamp:smoke --$/
  );
});

test('source builds use explicit, reviewed install scripts', () => {
  for (const lifecycle of ['preinstall', 'install', 'postinstall']) {
    assert.equal(packageManifest.scripts[lifecycle], undefined);
  }
  assert.equal(
    packageManifest.scripts.prepare,
    'node --experimental-strip-types scripts/update-source.ts --prepare --root ../..'
  );
  assert.equal(
    packageManifest.scripts['install:all'],
    'npm --prefix source run install:all'
  );

  const appManifest = JSON.parse(
    fs.readFileSync(path.join(HEADLAMP_SOURCE_DIR, 'app', 'package.json'), 'utf8')
  );
  assert.equal(appManifest.allowScripts, undefined);

  const frontendManifest = JSON.parse(
    fs.readFileSync(
      path.join(HEADLAMP_SOURCE_DIR, 'frontend', 'package.json'),
      'utf8'
    )
  );
  assert.equal(frontendManifest.dependencies.tsx, undefined);
  assert.equal(frontendManifest.allowScripts, undefined);
  assert.equal(frontendManifest.scripts.postbuild, 'tsx ./scripts/precompress-build.ts build');
  assert.equal(
    frontendManifest.scripts['postbuild:rsbuild'],
    'tsx ./scripts/precompress-build.ts build'
  );
  assert.equal(sourceManifest.devDependencies.tsx, '4.23.1');
  assert.match(sourceManifest.scripts['app:build'], /tsx \.\/scripts\/setup-plugins\.ts/);
  assert.match(sourceManifest.scripts['app:build:dir'], /tsx \.\/scripts\/setup-plugins\.ts/);
  assert.match(sourceManifest.scripts['app:start'], /tsx \.\/scripts\/setup-plugins\.ts/);
  assert.match(
    fs.readFileSync(
      path.join(
        HEADLAMP_SOURCE_DIR,
        'plugins',
        'headlamp-plugin',
        'dependencies-sync.js'
      ),
      'utf8'
    ),
    /dependenciesToNotCopy = \[[\s\S]*?'tsx'/
  );
  for (const lockPath of [
    'package-lock.json',
    'app/package-lock.json',
    'frontend/package-lock.json',
  ]) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(HEADLAMP_SOURCE_DIR, lockPath), 'utf8'),
      /\.pkgs\.visualstudio\.com/
    );
  }
});

test('packaged source file filtering ignores nested node_modules', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-files-filter-'));
  try {
    fs.writeFileSync(path.join(directory, 'included.tsx'), '');
    fs.mkdirSync(path.join(directory, 'node_modules'));
    fs.writeFileSync(path.join(directory, 'node_modules', 'ignored.tsx'), '');
    const { sync } = require(
      path.join(
        HEADLAMP_SOURCE_DIR,
        'frontend',
        'src',
        'filesFilter',
        'filesFilter.ts'
      )
    );

    assert.deepEqual(sync('^.*\\.tsx$', { ignore: /node_modules/, baseDir: directory }), [
      path.join(directory, 'included.tsx'),
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the root package supports the standard npm start command', () => {
  assert.equal(rootManifest.scripts.start, 'npm run dev');
  assert.equal(rootManifest.scripts.postinstall, 'npm run install:all');
  assert.equal(
    rootManifest.scripts['headlamp:prepare'],
    'node --experimental-strip-types packages/headlamp-source/scripts/update-source.ts --prepare --root .'
  );
  assert.equal(typeof rootManifest.scripts.dev, 'string');
});

test('container builds do not require repository metadata', () => {
  const dockerfile = fs.readFileSync(
    path.join(HEADLAMP_SOURCE_DIR, 'Dockerfile'),
    'utf8'
  );
  assert.doesNotMatch(dockerfile, /COPY \.git/);
  assert.match(dockerfile, /ARG HEADLAMP_SOURCE_COMMIT/);
  assert.match(dockerfile, /ARG HEADLAMP_BUILD_MANIFEST/);
  assert.match(
    packageManifest.scripts['build:container'],
    new RegExp(
      `--build-arg HEADLAMP_SOURCE_COMMIT=${rootManifest.headlampSource.commit}`
    )
  );
  assert.match(
    packageManifest.scripts['build:container'],
    /--build-arg HEADLAMP_BUILD_MANIFEST/
  );
});

test('frontend identity comes from package and product metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-identity-'));
  try {
    const manifestPath = path.join(directory, 'product.json');
    const outputPath = path.join(directory, '.env');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        product: { version: '1.2.3', productName: 'Example Desktop' },
      })
    );
    const result = spawnSync(
      process.execPath,
      [path.join(HEADLAMP_SOURCE_DIR, 'frontend', 'make-env.js'), outputPath],
      {
        cwd: path.join(HEADLAMP_SOURCE_DIR, 'frontend'),
        env: {
          ...process.env,
          HEADLAMP_BUILD_MANIFEST: manifestPath,
          HEADLAMP_SOURCE_COMMIT: '0123456789abcdef',
        },
        encoding: 'utf8',
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const environment = fs.readFileSync(outputPath, 'utf8');
    assert.match(environment, /^REACT_APP_HEADLAMP_VERSION='1\.2\.3'$/m);
    assert.match(
      environment,
      /^REACT_APP_HEADLAMP_GIT_VERSION='0123456789abcdef'$/m
    );
    assert.match(
      environment,
      /^REACT_APP_HEADLAMP_PRODUCT_NAME='Example Desktop'$/m
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('packaged executable paths come from product metadata', () => {
  const manifest = {
    product: { name: 'fallback', productName: 'Example Desktop' },
    platforms: {
      linux: { executableName: 'example' },
      mac: { executableName: 'example' },
      win: { executableName: 'example' },
    },
  };
  assert.ok(
    packagedExecutableCandidates('/dist', manifest, 'linux').includes(
      path.resolve('/dist/linux-unpacked/example')
    )
  );
  assert.ok(
    packagedExecutableCandidates('/dist', manifest, 'win32').includes(
      path.resolve('/dist/win-unpacked/example.exe')
    )
  );
  assert.ok(
    packagedExecutableCandidates('/dist', manifest, 'darwin').every(
      (candidate: string) =>
        candidate.endsWith(
          path.join('Example Desktop.app', 'Contents', 'MacOS', 'example')
        )
    )
  );
});
