#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');

const DMGBUILD_RELEASE = 'dmg-builder@1.2.5';
const DMGBUILD_BUNDLE_REVISION = '75c8a6c';
const DMGBUILD_CHECKSUMS = {
  'dmgbuild-bundle-arm64-75c8a6c.tar.gz':
    '793404d0c96687e27d5ee40a668d498c92e36a64d6c2906df511031adb33cbeb',
  'dmgbuild-bundle-x86_64-75c8a6c.tar.gz':
    '1664972f9cc2d6e8fce3b63e42cd30078aff602669c5856939c4519921200433',
};

async function main() {
  const appRequire = createRequire(path.join(process.cwd(), 'package.json'));
  const { downloadBuilderToolset } = appRequire('app-builder-lib/out/util/electronGet');
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const filenameWithExt = `dmgbuild-bundle-${arch}-${DMGBUILD_BUNDLE_REVISION}.tar.gz`;
  const toolDirectory = await downloadBuilderToolset({
    releaseName: DMGBUILD_RELEASE,
    filenameWithExt,
    checksums: DMGBUILD_CHECKSUMS,
  });
  const pythonDirectory = path.join(toolDirectory, 'python');
  const result = spawnSync(
    path.join(pythonDirectory, 'bin', 'python3'),
    [path.join(__dirname, 'dmgbuild-managed-mac.py'), ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: { ...process.env, PYTHONPATH: path.join(pythonDirectory, 'lib') },
    }
  );
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});