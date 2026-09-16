const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createManifest,
  mergeProductResources,
} = require('./generate-product-manifest.ts');

test('generates product resources and verified tools from consumer configuration', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-manifest-'));
  const packageDir = path.join(rootDir, 'headlamp-source');
  const appDir = path.join(packageDir, 'source', 'app');
  const toolFile = path.join(appDir, 'resources', 'tools', 'example');
  fs.mkdirSync(path.dirname(toolFile), { recursive: true });
  fs.writeFileSync(toolFile, 'example tool');
  fs.writeFileSync(path.join(rootDir, 'LICENSE.txt'), 'license');
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({
      version: '1.2.3',
      headlamp: {
        product: { name: 'example', productName: 'Example' },
        resources: {
          common: [{ from: 'existing-common', to: 'existing-common' }],
          linux: [{ from: 'existing-linux', to: 'existing-linux' }],
        },
        plugins: [
          {
            name: 'example',
            packageName: 'example',
            source: 'plugins/example',
          },
        ],
        runCommands: [
          {
            environment: 'development',
            pluginLocation: 'development',
            plugins: [{ bundleName: 'example', packageName: 'example' }],
            commands: [{ tool: 'examplectl', args: ['detect'] }],
          },
        ],
        build: {
          manifest: '.example/product-manifest.json',
          resources: [
            {
              base: 'project',
              from: 'LICENSE.txt',
              to: 'LICENSE.txt',
            },
          ],
          externalTools: [
            {
              id: 'example',
              platforms: {
                linux: {
                  file: 'resources/tools/example',
                  path: 'tools/example',
                },
              },
            },
          ],
        },
      },
    })
  );

  try {
    const { manifest, manifestPath } = createManifest({
      rootDir,
      packageDir,
      platform: 'linux',
    });

    assert.equal(manifestPath, path.join(appDir, '.example', 'product-manifest.json'));
    assert.equal(manifest.product.version, '1.2.3');
    assert.equal('build' in manifest, false);
    assert.equal('source' in manifest.plugins[0], false);
    assert.deepEqual(manifest.runCommands, [
      {
        environment: 'development',
        pluginLocation: 'development',
        plugins: [{ bundleName: 'example', packageName: 'example' }],
        commands: [{ tool: 'examplectl', args: ['detect'] }],
      },
    ]);
    assert.deepEqual(manifest.resources, {
      common: [
        { from: 'existing-common', to: 'existing-common' },
        {
          from: path
            .relative(path.dirname(manifestPath), path.join(rootDir, 'LICENSE.txt'))
            .split(path.sep)
            .join('/'),
          to: 'LICENSE.txt',
        },
      ],
      linux: [{ from: 'existing-linux', to: 'existing-linux' }],
    });
    const digest = createHash('sha256').update('example tool').digest('hex');
    assert.deepEqual(manifest['external-tools'], [
      {
        id: 'example',
        platforms: {
          linux: {
            path: 'tools/example',
            sha256: digest,
          },
        },
      },
    ]);
    assert.deepEqual(manifest.verify, [
      {
        path: 'tools/example',
        sha256: digest,
        platforms: ['linux'],
      },
    ]);

    const project = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')
    );
    project.headlamp.build.resources[0].base = 'headlamp-app';
    fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify(project));
    assert.throws(
      () => createManifest({ rootDir, packageDir, platform: 'linux' }),
      /Product resource base must be "headlampApp" or "project"/
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('rejects malformed product resource groups', () => {
  assert.throws(() => mergeProductResources([], []), /resources must be an object/);
  assert.throws(
    () => mergeProductResources({ common: {} }, []),
    /resources\.common must be an array/
  );
});

for (const [platform, platformKey, extension] of [
  ['darwin', 'mac', 'icns'],
  ['win32', 'win', 'ico'],
  ['linux', 'linux', 'png'],
]) {
  test(`resolves the ${platform} product icon from the consumer root for Electron Builder`, context => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product icon-'));
    context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const packageDir = path.join(rootDir, 'node_modules', '@headlamp-k8s', 'headlamp-source');
    const appDir = path.join(packageDir, 'source', 'app');
    const iconPath = path.join(rootDir, 'build', 'icons', `example-desktop.${extension}`);
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, 'icon fixture');
    const project = {
      headlamp: {
        product: { name: 'example-desktop', productName: 'Example Desktop' },
        plugins: [],
        platforms: { [platformKey]: { executableName: 'example-desktop' } },
        build: {
          icons: { [platformKey]: `build/icons/example-desktop.${extension}` },
          resources: [],
          externalTools: [],
        },
      },
    };
    const projectPath = path.join(rootDir, 'package.json');
    fs.writeFileSync(projectPath, JSON.stringify(project));
    const { manifest } = createManifest({ rootDir, packageDir, platform });
    assert.equal(path.resolve(appDir, manifest.platforms[platformKey].icon), iconPath);
    assert.equal(manifest.platforms[platformKey].executableName, 'example-desktop');
    assert.equal('build' in manifest, false);
    const otherPlatform = platform === 'linux' ? 'darwin' : 'linux';
    const otherManifest = createManifest({ rootDir, packageDir, platform: otherPlatform }).manifest;
    assert.equal(otherManifest.platforms[platformKey].icon, undefined);
    fs.rmSync(iconPath);
    assert.throws(() => createManifest({ rootDir, packageDir, platform }), /ENOENT/);
    project.headlamp.build.icons[platformKey] = `../outside.${extension}`;
    fs.writeFileSync(projectPath, JSON.stringify(project));
    assert.throws(() => createManifest({ rootDir, packageDir, platform }), /must stay within/);
  });
}
