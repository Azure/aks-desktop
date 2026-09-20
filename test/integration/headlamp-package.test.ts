import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PACKAGE_DIR = path.join(ROOT_DIR, 'packages', 'headlamp-source');
const {
  packageDir: HEADLAMP_PACKAGE_DIR,
  sourceDir: HEADLAMP_SOURCE_DIR,
} = require(path.join(PACKAGE_DIR, 'src', 'lib', 'paths.ts')).resolveInstalledHeadlampPaths(ROOT_DIR);

const { composePatchSeries } = require(
  path.join(PACKAGE_DIR, 'src', 'lib', 'compose-patches.ts')
);
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(HEADLAMP_PACKAGE_DIR, 'package.json'), 'utf8')
);
const rootManifest = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
);
const sourceManifest = JSON.parse(
  fs.readFileSync(path.join(HEADLAMP_SOURCE_DIR, 'package.json'), 'utf8')
);
const aksDesktopManifest = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'plugins', 'aks-desktop', 'package.json'), 'utf8')
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'package-lock.json'), 'utf8')
);
const VERSION = `0.0.0-main.${rootManifest.headlampSource.revision.slice(0, 8)}`;
const { packagedExecutableCandidates } = require(
  path.join(HEADLAMP_PACKAGE_DIR, 'src', 'lib', 'smoke-app.ts')
);

test('the installed package is a complete pinned source distribution', () => {
  assert.equal(fs.lstatSync(HEADLAMP_PACKAGE_DIR).isSymbolicLink(), false);
  assert.equal(packageManifest.name, '@headlamp-k8s/headlamp-source');
  assert.equal(packageManifest.version, VERSION);
  assert.deepEqual(packageManifest.files, ['source', 'src']);
  assert.equal(packageManifest.repository.url, 'https://github.com/kubernetes-sigs/headlamp.git');
  assert.deepEqual(rootManifest.headlampSource, {
    revision: 'd4c87a8fa3cc109b3ba992ca12e8eda45f5c77f0',
  });
  assert.deepEqual(packageManifest.headlampSource, rootManifest.headlampSource);
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

test('the install workflow owns and verifies the Headlamp patch', () => {
  const patchPath = `patches/headlamp-source@${VERSION}.patch`;
  assert.equal(rootManifest.headlampPatch.path, patchPath);
  assert.match(rootManifest.headlampPatch.integrity, /^sha512-/);
  const trackedPatch = spawnSync(
    'git',
    ['ls-files', '--error-unmatch', patchPath],
    { cwd: ROOT_DIR, encoding: 'utf8' }
  );
  assert.equal(trackedPatch.status, 0, trackedPatch.stderr);
  const lockEntry =
    packageLock.packages['node_modules/@headlamp-k8s/headlamp-source'];
  assert.equal(lockEntry.version, VERSION);
  assert.equal(lockEntry.resolved, 'file:packages/headlamp-source');
  const patch = fs.readFileSync(path.join(ROOT_DIR, patchPath));
  assert.equal(
    patch.equals(composePatchSeries(ROOT_DIR)),
    true
  );
  assert.doesNotMatch(
    patch.toString('utf8'),
    /^\+\s+"resolved": "https:\/\/[^\n"]*pkgs\.visualstudio\.com/m
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

test('the Headlamp loader gates development plugins through the hardened preload API', () => {
  const pluginLoader = fs.readFileSync(
    path.join(HEADLAMP_SOURCE_DIR, 'frontend', 'src', 'plugin', 'index.ts'),
    'utf8'
  );
  const preload = fs.readFileSync(
    path.join(HEADLAMP_SOURCE_DIR, 'app', 'electron', 'preload.ts'),
    'utf8'
  );

  assert.match(pluginLoader, /await filterDisabledDevelopmentPlugins\(/);
  assert.match(
    preload,
    /getDevelopmentPluginsEnabled: \(\) => ipcRenderer\.invoke\('get-development-plugins'\)/
  );
});

test('source builds use explicit, reviewed install scripts', () => {
  for (const lifecycle of ['preinstall', 'install', 'postinstall']) {
    assert.equal(packageManifest.scripts[lifecycle], undefined);
  }
  assert.equal(
    packageManifest.scripts.prepare,
    'node --experimental-strip-types src/bin/update-source.ts --prepare'
  );
  assert.equal(
    packageManifest.scripts['install:all'],
    'npm --prefix source run install:all'
  );

  const appManifest = JSON.parse(
    fs.readFileSync(path.join(HEADLAMP_SOURCE_DIR, 'app', 'package.json'), 'utf8')
  );
  const appLock = JSON.parse(
    fs.readFileSync(path.join(HEADLAMP_SOURCE_DIR, 'app', 'package-lock.json'), 'utf8')
  );
  const electronVersion = appLock.packages['node_modules/electron'].version;
  assert.deepEqual(appManifest.allowScripts, {
    electron: true,
  });
  assert.equal(appManifest.devDependencies.electron, `^${electronVersion}`);
  for (const script of ['dev-only-app', 'dev-only-app:debug']) {
    assert.match(appManifest.scripts[script], /HEADLAMP_BACKEND_TOKEN=headlamp/);
  }

  const frontendManifest = JSON.parse(
    fs.readFileSync(
      path.join(HEADLAMP_SOURCE_DIR, 'frontend', 'package.json'),
      'utf8'
    )
  );
  assert.equal(frontendManifest.dependencies.tsx, '4.23.1');
  assert.equal(frontendManifest.allowScripts, undefined);
  assert.match(frontendManifest.scripts.start, /REACT_APP_HEADLAMP_BACKEND_TOKEN=headlamp/);
  assert.match(sourceManifest.scripts['backend:start'], /HEADLAMP_BACKEND_TOKEN=headlamp/);
  assert.equal(frontendManifest.scripts.postbuild, 'tsx ./scripts/precompress-build.ts build');
  assert.equal(frontendManifest.scripts['build:rsbuild'], undefined);
  assert.equal(frontendManifest.scripts['postbuild:rsbuild'], undefined);
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
  assert.equal(
    rootManifest.scripts.postinstall,
    'npm run headlamp:patch-installed && npm run install:all'
  );
  assert.equal(
    rootManifest.devDependencies['@headlamp-k8s/headlamp-source'],
    'file:packages/headlamp-source'
  );
  assert.equal(
    rootManifest.scripts['headlamp:prepare'],
    'node --experimental-strip-types packages/headlamp-source/src/bin/update-source.ts --prepare --root .'
  );
  assert.equal(typeof rootManifest.scripts.dev, 'string');
});

test('root builds package supported host targets independently', () => {
  assert.equal(rootManifest.scripts.build, 'tsx ./build/build-host-platform.ts');
  for (const target of [
    'linux:x64',
    'linux:arm64',
    'mac:x64',
    'mac:arm64',
    'win:x64',
    'win:arm64',
  ]) {
    assert.match(rootManifest.scripts[`build:${target}`], /build\/package-target\.ts/);
  }
  assert.equal(rootManifest.scripts['build:linux:armv7l'], undefined);
  assert.equal(
    rootManifest.scripts['headlamp:translations'],
    'node Localize/translation-manager.mjs distribute-headlamp'
  );
  assert.match(rootManifest.scripts['headlamp:assemble'], /headlamp:translations/);
});

test('ARM64 package targets have verified external tool runtimes', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.match(rootManifest.config.externalTools.python[platform].arm64.url, /aarch64/);
    assert.match(
      rootManifest.config.externalTools.python[platform].arm64.checksum,
      /^[0-9a-f]{64}$/
    );
  }
  const azureCli = rootManifest.config.externalTools.azureCli;
  assert.equal(azureCli.version, '2.89.0');
  const windowsArm = azureCli.win32.arm64;
  assert.equal(
    new URL(windowsArm.url).pathname.split('/').at(-1),
    `azure-cli-${azureCli.version}-x64.zip`
  );
  assert.equal(windowsArm.url, azureCli.win32.x64.url);
  assert.equal(windowsArm.checksum, azureCli.win32.x64.checksum);
  assert.match(windowsArm.checksum, /^[0-9a-f]{64}$/);
  assert.equal(windowsArm.runtimeArch, 'x64');
});

test('all shipped plugin workspaces are packaged and installed', () => {
  const catalog = (rootManifest.headlamp.plugins as any[]).find(
    plugin => plugin.name === 'plugin-catalog'
  );
  assert.deepEqual(catalog, {
    name: 'plugin-catalog',
    packageName: '@headlamp-k8s/plugin-catalog',
    source: 'plugins/plugin-catalog',
    enabledByDefault: true,
  });
  assert.match(rootManifest.scripts['install:all'], /plugin-catalog:install/);
});

test('AKS product policy owns development and production command grants', () => {
  const aksDesktop = (rootManifest.headlamp.plugins as any[]).find(
    plugin => plugin.name === 'aks-desktop'
  );
  assert.equal(aksDesktop.capabilities, undefined);
  assert.equal(aksDesktopManifest.headlamp.runCommands, undefined);
  const policies: any[] = rootManifest.headlamp.runCommands;
  assert.deepEqual(
    policies.map(policy => ({
      environment: policy.environment,
      pluginLocation: policy.pluginLocation,
      plugins: policy.plugins,
    })),
    [
      {
        environment: 'development',
        pluginLocation: 'development',
        plugins: [{ bundleName: 'aks-desktop', packageName: 'aks-desktop' }],
      },
      {
        environment: 'development',
        pluginLocation: 'development',
        plugins: [
          { bundleName: 'ai-assistant', packageName: '@headlamp-k8s/ai-assistant' },
        ],
      },
      {
        environment: 'production',
        pluginLocation: 'shipped',
        plugins: [{ bundleName: 'aks-desktop', packageName: 'aks-desktop' }],
      },
      {
        environment: 'production',
        pluginLocation: 'shipped',
        plugins: [
          { bundleName: 'ai-assistant', packageName: '@headlamp-k8s/ai-assistant' },
        ],
      },
    ]
  );
  assert.deepEqual(policies[0].commands, policies[2].commands);
  assert.deepEqual(policies[1].commands, policies[3].commands);
  assert.equal(policies.every(policy => policy.pluginExecutables === undefined), true);
  const productGrants: any[] = policies[0].commands;
  assert.equal(productGrants.some(grant => 'command' in grant), false);
  assert.equal(productGrants.some(grant => 'executable' in grant), false);
  for (const group of ['ad', 'identity', 'provider', 'rest']) {
    assert.ok(
      productGrants.some(
        grant => grant.tool === 'az' && grant.args[0] === group && grant.allowTrailingArgs
      ),
      `Missing az ${group} command grant`
    );
  }
  assert.ok(
    productGrants.some(
      grant =>
        grant.tool === 'kubectl' &&
        grant.args[0] === 'config' &&
        grant.allowTrailingArgs
    ),
    'Missing kubectl config command grant'
  );
  assert.deepEqual(policies[1].commands, [
    { tool: 'gh', args: ['auth', 'token'] },
    {
      tool: 'az',
      args: [
        'account',
        'get-access-token',
        '--resource',
        'https://management.azure.com/',
        '--query',
        'accessToken',
        '-o',
        'tsv',
      ],
    },
  ]);
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
      `--build-arg HEADLAMP_SOURCE_COMMIT=${rootManifest.headlampSource.revision}`
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
    assert.match(environment, /^REACT_APP_HEADLAMP_VERSION='0\.45\.0'$/m);
    assert.match(
      environment,
      /^REACT_APP_HEADLAMP_GIT_VERSION='0123456789abcdef'$/m
    );
    assert.match(
      environment,
      /^REACT_APP_HEADLAMP_PRODUCT_NAME='Example Desktop'$/m
    );
    assert.match(
      environment,
      /^REACT_APP_HEADLAMP_PRODUCT_VERSION='1\.2\.3'$/m
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const [platform, platformKey] of [
  ['win32', 'win'],
  ['darwin', 'mac'],
  ['linux', 'linux'],
]) {
  test(`${platform} packaging preserves the AKS app name and release version`, context => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aks package version-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { createManifest } = require(
      path.join(PACKAGE_DIR, 'src', 'lib', 'generate-product-manifest.ts')
    );
    const project = structuredClone(rootManifest);
    project.headlamp.build = {
      productNames: rootManifest.headlamp.build.productNames,
      resources: [],
      externalTools: [],
    };
    const manifestPath = path.join(directory, 'product.json');
    for (const version of [rootManifest.version, '9.8.7']) {
      project.version = version;
      project.headlamp.product.version = '0.0.0';
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(project));
      const { manifest } = createManifest({
        rootDir: directory,
        packageDir: HEADLAMP_PACKAGE_DIR,
        platform,
      });
      assert.equal(manifest.product.version, version);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(require.resolve('tsx')).href,
          '--eval',
          `
            const config = require('./electron-builder.config.ts').default;
            const { AppInfo } = require('app-builder-lib/out/appInfo');
            const appPackage = require('./package.json');
            const metadata = { ...appPackage, ...config.extraMetadata };
            const options = config[process.argv[1]];
            const appInfo = new AppInfo({ metadata, config }, undefined, options);
            console.log(JSON.stringify({
              productName: appInfo.productName,
              productFilename: appInfo.productFilename,
              executableName: options.executableName,
              version: appInfo.version,
              buildVersion: appInfo.buildVersion,
              fileVersion: appInfo.shortVersion || appInfo.buildVersion,
              windowsProductVersion:
                appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm(false),
              bundleVersion: options.bundleVersion || appInfo.buildVersion,
              bundleShortVersion: options.bundleShortVersion || appInfo.version,
            }));
          `,
          platformKey,
        ],
        {
          cwd: path.join(HEADLAMP_SOURCE_DIR, 'app'),
          env: { ...process.env, HEADLAMP_BUILD_MANIFEST: manifestPath },
          encoding: 'utf8',
        }
      );
      assert.equal(result.status, 0, result.stderr || result.error?.message || 'Version probe failed');
      const effective = JSON.parse(result.stdout);
      assert.equal(effective.version, version);
      assert.equal(effective.buildVersion, version);
      const executableName = platformKey === 'linux' ? 'aks-desktop' : 'AKS desktop';
      assert.equal(effective.executableName, executableName);
      assert.equal(effective.productName, platformKey === 'linux' ? 'AKS-Desktop' : 'AKS desktop');
      assert.equal(effective.productFilename, executableName);
      for (const arch of ['x64', 'arm64']) {
        const executable = platformKey === 'mac'
          ? path.join('AKS desktop.app', 'Contents', 'MacOS', 'AKS desktop')
          : platformKey === 'win' ? 'AKS desktop.exe' : 'aks-desktop';
        const candidates = packagedExecutableCandidates('/dist', manifest, platform, arch);
        assert.ok(candidates.length > 0);
        assert.ok(candidates.every((candidate: string) => candidate.endsWith(path.sep + executable)));
      }
      if (platformKey === 'win') {
        assert.equal(effective.fileVersion, version);
        assert.equal(effective.windowsProductVersion, `${version.split('-')[0]}.0`);
      } else if (platformKey === 'mac') {
        assert.equal(effective.bundleVersion, version);
        assert.equal(effective.bundleShortVersion, version);
      }
    }
  });
}

test('error and not-found graphics use the product-owned artwork', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aks error graphics-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { generateFrontendEnvironment } = require(path.join(ROOT_DIR, 'build', 'generate-frontend-environment.ts'));
  const { sourceDir } = require(path.join(PACKAGE_DIR, 'src', 'lib', 'paths.ts')).resolveInstalledHeadlampPaths(directory);
  fs.mkdirSync(path.join(sourceDir, 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'build', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(rootManifest));
  const graphics = [
    ['ERROR', 'aks-desktop-error.svg'],
    ['NOT_FOUND', 'aks-desktop-not-found.svg'],
  ];
  for (const [, graphic] of graphics) {
    fs.copyFileSync(path.join(ROOT_DIR, 'build', 'icons', graphic), path.join(directory, 'build', 'icons', graphic));
  }
  const environment = parseEnv(fs.readFileSync(generateFrontendEnvironment(directory), 'utf8'));
  for (const [page, graphic] of graphics) {
    const key = `REACT_APP_HEADLAMP_${page}_PAGE_GRAPHIC`;
    const asset = fs.readFileSync(path.join(ROOT_DIR, 'build', 'icons', graphic));
    assert.deepEqual(rootManifest.headlamp.build.frontendEnvironment[key], { file: `build/icons/${graphic}` });
    assert.equal(environment[key], `data:image/svg+xml;base64,${asset.toString('base64')}`);
    assert.match(environment[`REACT_APP_HEADLAMP_${page}_PAGE_TITLE`] ?? '', /AKS Desktop/);
  }
  assert.notEqual(environment.REACT_APP_HEADLAMP_ERROR_PAGE_GRAPHIC, environment.REACT_APP_HEADLAMP_NOT_FOUND_PAGE_GRAPHIC);
});

test('product packaging declares valid AKS icons for every desktop platform', () => {
  const icons = rootManifest.headlamp.build.icons;
  assert.deepEqual(icons, {
    mac: 'build/icons/aks-desktop.icns',
    win: 'build/icons/aks-desktop.ico',
    linux: 'build/icons/aks-desktop.png',
  });
  const mac = fs.readFileSync(path.join(ROOT_DIR, icons.mac));
  assert.equal(mac.subarray(0, 4).toString('ascii'), 'icns');
  assert.equal(mac.readUInt32BE(4), mac.length);
  const linux = fs.readFileSync(path.join(ROOT_DIR, icons.linux));
  assert.equal(linux.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(linux.readUInt32BE(16), 512);
  assert.equal(linux.readUInt32BE(20), 512);
  const windows = fs.readFileSync(path.join(ROOT_DIR, icons.win));
  assert.equal(windows.readUInt16LE(0), 0);
  assert.equal(windows.readUInt16LE(2), 1);
  const sizes = Array.from({ length: windows.readUInt16LE(4) }, (_, index) => ({
    width: windows[6 + index * 16] || 256,
    height: windows[7 + index * 16] || 256,
  }));
  assert.ok(sizes.some(size => size.width >= 256 && size.height >= 256));
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
    packagedExecutableCandidates('/dist', manifest, 'linux', 'x64').includes(
      path.resolve('/dist/linux-unpacked/example')
    )
  );
  assert.ok(
    packagedExecutableCandidates('/dist', manifest, 'win32', 'x64').includes(
      path.resolve('/dist/win-unpacked/example.exe')
    )
  );
  assert.ok(
    packagedExecutableCandidates('/dist', manifest, 'darwin').every(
      (candidate: string) =>
        candidate.endsWith(path.join('example.app', 'Contents', 'MacOS', 'example'))
    )
  );
});
