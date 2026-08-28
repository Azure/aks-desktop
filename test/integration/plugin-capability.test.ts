import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const { sourceDir: HEADLAMP_SOURCE_DIR } = require(
  path.join(ROOT_DIR, 'packages', 'headlamp-source', 'scripts', 'paths.ts')
).resolveInstalledHeadlampPaths(ROOT_DIR);
const { runPlugin } = require(
  path.join(HEADLAMP_SOURCE_DIR, 'frontend', 'src', 'plugin', 'runPlugin.ts')
);
const { getStartClusterProxyCapability } = require(
  path.join(
    ROOT_DIR,
    'plugins',
    'aks-desktop',
    'src',
    'utils',
    'azure',
    'clusterProxyCapability.ts'
  )
);

const integrationGlobal = globalThis as typeof globalThis & {
  __aksProxyCapability?: (target: unknown) => Promise<unknown>;
  __aksProxyResult?: Promise<unknown>;
};

test.afterEach(() => {
  delete integrationGlobal.__aksProxyCapability;
  delete integrationGlobal.__aksProxyResult;
});

test('the Headlamp loader injects the private cluster proxy capability', async () => {
  const calls: unknown[] = [];
  const desktopStartClusterProxy = async (target: unknown) => {
    calls.push(target);
    return { success: true };
  };
  const errors: unknown[] = [];
  const target = {
    cluster: 'cluster-a',
    subscriptionId: 'sub-a',
    resourceGroup: 'rg-a',
  };
  const source = `
    globalThis.__aksProxyCapability = (${getStartClusterProxyCapability.toString()})();
    globalThis.__aksProxyResult = globalThis.__aksProxyCapability(${JSON.stringify(target)});
  `;

  runPlugin(
    source,
    'aks-desktop',
    '0.9.0',
    (error: unknown) => errors.push(error),
    Function,
    ['startClusterProxy'],
    [desktopStartClusterProxy]
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(await integrationGlobal.__aksProxyResult, { success: true });
  assert.deepEqual(calls, [target]);
});

test('the Headlamp loader does not expose a capability it did not inject', () => {
  const errors: unknown[] = [];
  const source = `
    globalThis.__aksProxyCapability = (${getStartClusterProxyCapability.toString()})();
  `;

  runPlugin(
    source,
    'other-plugin',
    '1.0.0',
    (error: unknown) => errors.push(error),
    Function,
    [],
    []
  );

  assert.deepEqual(errors, []);
  assert.equal(integrationGlobal.__aksProxyCapability, undefined);
});