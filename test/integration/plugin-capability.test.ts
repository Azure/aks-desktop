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

test('the product grants AI assistant auto-detect commands in every app environment', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
  ).headlamp;

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

test('AKS approvals retain main defaults plus scoped directory reads', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).headlamp;
  for (const environment of ['development', 'production'] as const) {
    const policy = productPluginCommandPolicies(manifest, environment).find(
      (candidate: { packageName: string }) => candidate.packageName === 'aks-desktop'
    );
    assert.ok(policy, `Missing ${environment} AKS command policy`);
    assert.equal(policy.bundleName, 'aks-desktop');
    const prefixes = [
      '--version', 'version', 'login', 'logout', 'config', 'aks', 'connectedk8s',
      'aksarc', 'extension', 'feature', 'provider', 'account', 'role', 'graph',
      'acr', 'group', 'vm', 'alerts-management', 'monitor',
    ];
    assert.deepEqual(policy.approvedCommands, [
      { tool: 'az', args: [] },
      ...prefixes.map(prefix => ({ tool: 'az', args: [prefix], allowTrailingArgs: true })),
      { tool: 'kubectl', args: ['top'], allowTrailingArgs: true },
      { tool: 'kubectl', args: ['config'], allowTrailingArgs: true },
      { tool: 'az', args: ['ad', 'user', 'list'], allowTrailingArgs: true },
      { tool: 'az', args: ['ad', 'user', 'show'], allowTrailingArgs: true },
    ]);
    assert.equal(policy.consent, undefined);
    assert.equal(policy.source, environment === 'development' ? 'development' : 'shipped');
    for (const args of [['version'], ['account', 'show', '-o', 'json'], ['extension', 'list']]) {
      assert.equal(isRunCommandAllowed(policy.grants, 'az', args), true);
      assert.equal(isRunCommandAllowed(policy.approvedCommands, 'az', args), true);
    }
    assert.equal(isRunCommandAllowed(policy.grants, 'az', ['rest']), true);
    assert.equal(isRunCommandAllowed(policy.approvedCommands, 'az', ['rest']), false);
    assert.equal(isRunCommandAllowed(policy.approvedCommands, 'kubectl', ['top', 'nodes']), true);
    assert.equal(isRunCommandAllowed(policy.grants, 'kubectl', ['top', 'nodes']), false);
    assert.equal(isRunCommandAllowed(policy.approvedCommands, 'az', []), true);
    assert.equal(isRunCommandAllowed(policy.approvedCommands, 'az', ['unknown']), false);
    assert.equal(isRunCommandAllowed(policy.grants, 'sh', ['-c', 'command']), false);
  }
});

test('AKS project user lookup approvals do not approve directory writes or other plugins', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).headlamp;
  for (const environment of ['development', 'production'] as const) {
    const policies = productPluginCommandPolicies(manifest, environment);
    const policy = policies.find((candidate: { packageName: string }) => candidate.packageName === 'aks-desktop');
    assert.ok(policy);
    for (const args of [
      ['ad', 'user', 'list', '--filter', "startswith(displayName,'Example')", '--output', 'json'],
      ['ad', 'user', 'show', '--id', 'user@example.com', '--output', 'json'],
    ]) {
      assert.equal(isRunCommandAllowed(policy.grants, 'az', args), true);
      assert.equal(isRunCommandAllowed(policy.approvedCommands, 'az', args), true);
      for (const other of policies.filter((candidate: { packageName: string }) => candidate.packageName !== 'aks-desktop')) {
        assert.equal(isRunCommandAllowed(other.approvedCommands ?? [], 'az', args), false);
      }
    }
    for (const args of [
      ['ad'], ['ad', 'user'], ['ad', 'user', 'delete', '--id', 'user@example.com'],
      ['ad', 'user', 'update', '--id', 'user@example.com'], ['ad', 'user', 'create'],
      ['ad', 'app', 'create'], ['ad', 'group', 'delete'], ['ad', 'user', 'list-extra'],
    ]) {
      assert.equal(isRunCommandAllowed(policy.approvedCommands, 'az', args), false);
    }
  }
});