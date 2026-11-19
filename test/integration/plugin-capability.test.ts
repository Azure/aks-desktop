import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const { sourceDir: HEADLAMP_SOURCE_DIR } = require(
  path.join(ROOT_DIR, 'packages', 'headlamp-source', 'src', 'lib', 'paths.ts')
).resolveInstalledHeadlampPaths(ROOT_DIR);
const { runPlugin } = require(
  path.join(HEADLAMP_SOURCE_DIR, 'frontend', 'src', 'plugin', 'runPlugin.ts')
);
const { productPluginCommandPolicies } = require(
  path.join(HEADLAMP_SOURCE_DIR, 'app', 'scripts', 'build-manifest.ts')
);
const { isRunCommandAllowed } = require(
  path.join(HEADLAMP_SOURCE_DIR, 'app', 'electron', 'runCommandPolicy.ts')
);
const { createProductTemplate } = require(
  path.join(ROOT_DIR, 'packages', 'headlamp-source', 'src', 'lib', 'product-manifest.ts')
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

/**
 * The product manifest a Windows x64 build generates, which includes the target-limited policies.
 * The generator removes the build-only `targets` field that Headlamp's manifest validation rejects.
 *
 * @returns The runtime product manifest generated from the repository's package.json.
 */
function productManifest() {
  const project = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  return createProductTemplate(project, 'win32', 'x64');
}

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

test('the product grants AI assistant auto-detect commands in every app environment', () => {
  const manifest = productManifest();

  for (const environment of ['development', 'production'] as const) {
    const policy = productPluginCommandPolicies(manifest, environment).find(
      (candidate: { packageName: string }) =>
        candidate.packageName === '@headlamp-k8s/ai-assistant'
    );
    assert.ok(policy, `Missing ${environment} AI assistant command policy`);
    assert.deepEqual(policy.approvedCommands, [
      { tool: 'gh', args: ['auth'], allowTrailingArgs: true },
      { tool: 'az', args: ['account'], allowTrailingArgs: true },
      { tool: 'az', args: ['cognitiveservices'], allowTrailingArgs: true },
    ]);
    assert.equal(policy.source, environment === 'development' ? 'development' : 'shipped');
    assert.equal(isRunCommandAllowed(policy.grants, 'gh', ['auth', 'token']), true);
    assert.equal(
      isRunCommandAllowed(policy.grants, 'az', [
        'account',
        'get-access-token',
        '--resource',
        'https://management.azure.com/',
        '--query',
        'accessToken',
        '-o',
        'tsv',
      ]),
      true
    );
    assert.equal(isRunCommandAllowed(policy.grants, 'gh', ['repo', 'delete']), false);
    assert.equal(isRunCommandAllowed(policy.grants, 'az', ['account', 'clear']), false);
  }
});

test('AKS command policies retain only current CLI consumers', () => {
  const manifest = productManifest();
  for (const environment of ['development', 'production'] as const) {
    const policy = productPluginCommandPolicies(manifest, environment).find(
      (candidate: { packageName: string }) => candidate.packageName === 'aks-desktop'
    );
    assert.ok(policy, `Missing ${environment} AKS command policy`);
    assert.equal(policy.bundleName, 'aks-desktop');
    const prefixes = [
      'login',
      'logout',
      'aks',
      'account',
      'cloud',
      'acr',
      'alerts-management',
      'monitor',
    ];
    assert.deepEqual(policy.approvedCommands, [
      ...prefixes.map(prefix => ({
        tool: 'az',
        args: prefix === 'cloud' ? ['cloud', 'show'] : [prefix],
        allowTrailingArgs: true,
      })),
      { tool: 'kubectl', args: ['config'], allowTrailingArgs: true },
    ]);
    assert.equal(policy.consent, undefined);
    assert.equal(policy.source, environment === 'development' ? 'development' : 'shipped');
    for (const args of [
      ['account', 'show', '-o', 'json'],
      ['aks', 'namespace', 'show'],
      ['acr', 'list'],
    ]) {
      assert.equal(isRunCommandAllowed(policy.grants, 'az', args), true);
      assert.equal(isRunCommandAllowed(policy.approvedCommands, 'az', args), true);
    }
    assert.equal(isRunCommandAllowed(policy.grants, 'az', ['identity', 'list']), true);
    for (const grants of [policy.grants, policy.approvedCommands]) {
      assert.equal(
        isRunCommandAllowed(grants, 'az', [
          'cloud',
          'show',
          '--name',
          'AzureUSGovernment',
        ]),
        true
      );
      assert.equal(isRunCommandAllowed(grants, 'az', ['cloud', 'set', '--name', 'AzureUSGovernment']), false);
      assert.equal(isRunCommandAllowed(grants, 'az', ['cloud', 'register', '--name', 'Other']), false);
      for (const args of [
        [],
        ['version'],
        ['config', 'set'],
        ['extension', 'list'],
        ['graph', 'query'],
        ['rest'],
        ['role', 'assignment', 'create'],
        ['role', 'assignment', 'list'],
        ['ad', 'user', 'list'],
        ['feature', 'show'],
        ['group', 'list'],
        ['connectedk8s', 'delete'],
        ['vm', 'list'],
        ['aksarc', 'list'],
      ]) {
        assert.equal(isRunCommandAllowed(grants, 'az', args), false);
      }
    }
    assert.equal(isRunCommandAllowed(policy.approvedCommands, 'kubectl', ['config', 'current-context']), true);
    assert.equal(isRunCommandAllowed(policy.grants, 'kubectl', ['config', 'current-context']), true);
    assert.equal(isRunCommandAllowed(policy.approvedCommands, 'kubectl', ['top', 'nodes']), false);
    assert.equal(isRunCommandAllowed(policy.grants, 'kubectl', ['top', 'nodes']), false);
    assert.equal(isRunCommandAllowed(policy.approvedCommands, 'az', ['unknown']), false);
    assert.equal(isRunCommandAllowed(policy.grants, 'sh', ['-c', 'command']), false);
  }
});

test('AKS project directory commands remain denied after the REST migration', () => {
  const manifest = productManifest();
  for (const environment of ['development', 'production'] as const) {
    const policies = productPluginCommandPolicies(manifest, environment);
    const policy = policies.find((candidate: { packageName: string }) => candidate.packageName === 'aks-desktop');
    assert.ok(policy);
    for (const args of [
      ['ad', 'user', 'list', '--filter', "startswith(displayName,'Example')", '--output', 'json'],
      ['ad', 'user', 'show', '--id', 'user@example.com', '--output', 'json'],
      ['ad'], ['ad', 'user'], ['ad', 'user', 'delete', '--id', 'user@example.com'],
      ['ad', 'user', 'update', '--id', 'user@example.com'], ['ad', 'user', 'create'],
      ['ad', 'app', 'create'], ['ad', 'group', 'delete'], ['ad', 'user', 'list-extra'],
    ]) {
      assert.equal(isRunCommandAllowed(policy.grants, 'az', args), false);
      assert.equal(isRunCommandAllowed(policy.approvedCommands, 'az', args), false);
    }
  }
});