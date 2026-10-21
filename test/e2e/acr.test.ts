// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { createServices, parseAcrRun, validateWorkflow, type Command } from './acr-services';
import {
  adaptWorkflow,
  assertRestWorkflow,
  CONTEXT_PATH,
  GATE_NAME,
  generateWorkflow,
  newRun,
  parseWorkflow,
  readConfig,
  redact,
  SCENARIOS,
  WORKFLOW_PATH,
  type AcrRun,
} from './acr-workflow';

const env = {
  AKSD_E2E_REPOSITORY: 'example/sandbox',
  AKSD_E2E_BRANCH: 'aksd-acr-e2e',
  AKSD_E2E_ACR_RESOURCE_ID:
    '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/test-rg/providers/Microsoft.ContainerRegistry/registries/testregistry',
  AKSD_E2E_ACR_LOGIN_SERVER: 'testregistry.azurecr.io',
  AKSD_E2E_EXCLUSIVE_REGISTRY: '1',
};
const config = readConfig(env);

test('live opt-in requires explicit sandbox configuration and exclusive registry acknowledgment', () => {
  assert.throws(() => readConfig({}), /Missing E2E configuration/);
  assert.throws(
    () => readConfig({ ...env, AKSD_E2E_EXCLUSIVE_REGISTRY: '' }),
    /EXCLUSIVE_REGISTRY/
  );
  assert.throws(() => readConfig({ ...env, AKSD_E2E_BRANCH: 'main' }), /dedicated/);
  assert.throws(() => readConfig({ ...env, AKSD_E2E_ACR_LOGIN_SERVER: 'other.azurecr.io' }));
  assert.equal(config.registryName, 'testregistry');
});

test('sandbox configuration accepts Unicode resource-group names', () => {
  const registryId = env.AKSD_E2E_ACR_RESOURCE_ID.replace('/test-rg/', '/équipe/');
  assert.equal(readConfig({ ...env, AKSD_E2E_ACR_RESOURCE_ID: registryId }).registryId, registryId);
});

test('adapter changes only dispatch and deployment steps, preserving generated metadata', () => {
  const build = {
    permissions: { 'id-token': 'write' },
    steps: [{ run: 'node build.mjs' }],
    'timeout-minutes': 9,
  };
  const deploy = {
    needs: ['buildImage'],
    if: '${{ success() }}',
    'continue-on-error': false,
    'runs-on': 'ubuntu-latest',
    steps: [{ run: 'kubectl apply -f manifests' }],
  };
  const source = {
    name: 'Generated',
    on: { push: null },
    concurrency: { group: 'original' },
    env: { VALUE: 'unchanged' },
    jobs: { buildImage: build, deploy },
  };
  assert.deepEqual(parseWorkflow(adaptWorkflow(JSON.stringify(source))), {
    ...source,
    on: { workflow_dispatch: null },
    jobs: {
      buildImage: build,
      deploy: {
        ...deploy,
        name: GATE_NAME,
        permissions: {},
        steps: [
          {
            name: GATE_NAME,
            run: 'echo "Generated build succeeded; no AKS deployment performed"',
          },
        ],
      },
    },
  });
  assert.deepEqual(source.jobs.deploy, deploy);
  assert.throws(() => adaptWorkflow('{}'), /generated jobs/);
});

test('old CLI workflows and ambiguous ACR correlation fail closed', () => {
  assert.throws(() => assertRestWorkflow('run: az acr build --registry test .'), /REST-29/);
  assert.doesNotThrow(() => assertRestWorkflow('run: node generated-build.mjs'));
  const run = (id: string): AcrRun => ({ id, status: 'Running', images: [] });
  assert.equal(newRun(new Set(['old']), [run('old')]), undefined);
  assert.equal(newRun(new Set(['old']), [run('old'), run('new')])?.id, 'new');
  assert.throws(() => newRun(new Set(), [run('one'), run('two')]), /exclusive-registry/);
});

test('external Dockerfile uses the same generated runner and nested context as ordinary success', () => {
  assert.deepEqual(SCENARIOS, ['success', 'external', 'failure', 'cancel']);
  const ordinary = parseWorkflow(generateWorkflow(config, 'rest29-success', 'nested-proof'));
  const externalPath = 'fixtures/acr-e2e/docker/Buildfile';
  const external = parseWorkflow(
    generateWorkflow(config, 'rest29-success', 'nested-proof', externalPath)
  );
  const nestedPath = `${CONTEXT_PATH}/Dockerfile`;
  assert.equal((ordinary.env as Record<string, unknown>).DOCKER_FILE, nestedPath);
  assert.equal((external.env as Record<string, unknown>).DOCKER_FILE, externalPath);
  assert.equal((external.env as Record<string, unknown>).BUILD_CONTEXT_PATH, CONTEXT_PATH);
  assert.deepEqual(
    external,
    JSON.parse(JSON.stringify(ordinary).replaceAll(nestedPath, externalPath))
  );
});

test('evidence redacts SAS queries, bearer tokens and JWTs', () => {
  const bearer = ['Bearer', 'sensitive-token'].join(' ');
  const result = redact(
    `https://test.blob.core.windows.net/log?sig=private&sv=1 ${bearer} eyJabc.def.ghi`
  );
  assert.doesNotMatch(result, /sig=|private|sensitive-token|eyJabc/);
});

test('ACR parsing follows ARM run properties and rejects malformed responses', () => {
  const images = [{ repository: 'rest29-test', tag: 'sha' }];
  assert.deepEqual(
    parseAcrRun({ properties: { runId: 'one', status: 'Succeeded', outputImages: images } }),
    { id: 'one', status: 'Succeeded', images }
  );
  assert.throws(() => parseAcrRun({ status: 'Succeeded' }), /properties/);
});

for (const changed of [false, true]) {
  test(`publisher commits without force and rejects concurrent updates: ${changed}`, async () => {
    const responses = [
      { object: { sha: 'parent' } },
      { tree: { sha: 'base' } },
      { sha: 'tree' },
      { sha: 'new' },
      { object: { sha: changed ? 'other' : 'parent' } },
      {},
    ];
    const calls: Array<{ args: string[]; body?: unknown }> = [];
    const execute: Command = async (binary, args, input) => {
      assert.equal(binary, 'gh');
      calls.push({ args, body: input ? JSON.parse(input) : undefined });
      assert.ok(responses.length, 'Unexpected publisher request');
      return JSON.stringify(responses.shift());
    };
    const files = { [WORKFLOW_PATH]: 'generated', 'fixtures/marker.txt': 'fixture' };
    const publish = createServices(config, '/unused', execute).publish(files);
    if (changed) {
      await assert.rejects(publish, /concurrently/);
      assert.equal(calls.length, 5, 'A concurrent branch update must not be overwritten');
    } else {
      assert.equal(await publish, 'new');
      assert.match(calls[2].args[1], /\/git\/trees$/);
      assert.deepEqual(calls[2].body, {
        base_tree: 'base',
        tree: Object.entries(files).map(([path, content]) => ({
          path,
          mode: '100644',
          type: 'blob',
          content,
        })),
      });
      assert.ok(calls.at(-1)?.args.includes('PATCH'));
      assert.deepEqual(calls.at(-1)?.body, { sha: 'new', force: false });
    }
  });
}

test('preflight rejects the default branch before any remote mutation', async () => {
  await assert.rejects(
    createServices(config, '/unused', async () =>
      JSON.stringify({ default_branch: config.branch })
    ).preflight(),
    /default branch/
  );
});

test('ARM run requests encode Unicode scope and retain the registry boundary guard', async () => {
  const registryId = config.registryId.replace('/test-rg/', '/équipe/');
  const execute: Command = async (binary, args) => {
    assert.equal(binary, 'az');
    const url = new URL(args[args.indexOf('--url') + 1]);
    assert.equal(url.origin, 'https://management.azure.com');
    assert.ok(url.pathname.includes('/resourceGroups/%C3%A9quipe/'));
    return JSON.stringify({ value: [] });
  };
  await createServices({ ...config, registryId }, '/unused', execute).runs();
});

test('preflight uses supported ACR show arguments and the registry subscription', async () => {
  const githubResponses = [
    { default_branch: 'main' },
    { object: { sha: 'branch' } },
    { path: WORKFLOW_PATH },
    { state: 'active' },
  ];
  let registryReads = 0;
  const execute: Command = async (binary, args) => {
    if (binary === 'gh') {
      assert.ok(args.includes('GET'), 'Preflight must not mutate GitHub');
      assert.ok(githubResponses.length);
      return JSON.stringify(githubResponses.shift());
    }
    assert.equal(binary, 'az');
    assert.deepEqual(args, [
      'acr',
      'show',
      '--name',
      'testregistry',
      '--resource-group',
      'test-rg',
      '--subscription',
      '11111111-1111-1111-1111-111111111111',
      '--only-show-errors',
      '--output',
      'json',
    ]);
    registryReads++;
    return JSON.stringify({ loginServer: config.loginServer, publicNetworkAccess: 'Enabled' });
  };

  await createServices(config, '/unused', execute).preflight();

  assert.equal(registryReads, 1);
  assert.equal(githubResponses.length, 0);
});

test('workflow discovery rejects duplicate dispatches for a fixture SHA', async () => {
  const run = {
    id: 1,
    head_sha: 'expected',
    status: 'queued',
    conclusion: null,
    html_url: 'https://github.com/example/sandbox/actions/runs/1',
  };
  const execute: Command = async (_binary, args) => {
    assert.match(args[1], /head_sha=expected/);
    return JSON.stringify({ workflow_runs: [run, run] });
  };
  await assert.rejects(
    createServices(config, '/unused', execute).findWorkflow('expected'),
    /Multiple workflows/
  );
});

test('image verification and deletion reject non-E2E image names without executing commands', async () => {
  const execute: Command = async () => {
    throw new Error('Must not execute');
  };
  const client = createServices(config, '/unused', execute);
  await assert.rejects(client.deleteImage('production:latest'), /non-E2E/);
  await assert.rejects(client.verifyImage('production:latest'), /non-E2E/);
});

test('workflow lint receives the exact generated YAML via stdin', async () => {
  await validateWorkflow(
    { [WORKFLOW_PATH]: 'exact generated workflow' },
    async (binary, args, input) => {
      assert.equal(binary, 'actionlint');
      assert.deepEqual(args, ['-shellcheck=', '-']);
      assert.equal(input, 'exact generated workflow');
      return '';
    }
  );
});

for (const [digest, valid] of [
  [`sha256:${'a'.repeat(64)}`, true],
  ['sha256:invalid', false],
  [undefined, false],
] as const) {
  test(`registry image metadata requires a valid digest: ${digest}`, async () => {
    const image = `rest29-test:${'b'.repeat(40)}`;
    const execute: Command = async (binary, args) => {
      assert.equal(binary, 'az');
      assert.deepEqual(args, [
        'acr',
        'repository',
        'show',
        '--name',
        config.registryName,
        '--subscription',
        config.registryId.split('/')[2],
        '--image',
        image,
        '--only-show-errors',
        '--output',
        'json',
      ]);
      return JSON.stringify({ digest });
    };
    const verification = createServices(config, '/unused', execute).verifyImage(image);
    if (valid) await verification;
    else await assert.rejects(verification, /image digest/);
  });
}

test(
  'success fixture emits its proof only after context and build-argument checks',
  {
    skip: process.platform === 'win32',
  },
  async t => {
    const fixture = await fs.readFile(
      path.join(__dirname, 'fixtures/acr/success.Dockerfile'),
      'utf8'
    );
    const run = fixture.match(/\nRUN ([\s\S]*?)\r?\n\r?\n/)?.[1];
    assert.ok(run, 'Missing success-fixture RUN block');
    const directory = await fs.mkdtemp(path.resolve('test/e2e/.acr-source-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const marker = 'fixture-build-argument';
    await fs.mkdir(path.join(directory, 'ignored'));
    await fs.writeFile(path.join(directory, 'included.txt'), 'nested-context-marker');
    await fs.writeFile(path.join(directory, 'ignored', 'keep.txt'), marker);
    const script = run.replaceAll('/context/', `'${directory.replaceAll("'", "'\\''")}'/`);
    for (const [file, argument] of [
      [undefined, marker],
      [undefined, ''],
      [undefined, 'wrong'],
      ['ignored.txt', marker],
      ['ignored/drop.txt', marker],
      ['outside-context.txt', marker],
      ['.aksd-acr', marker],
      ['included.txt', marker],
    ] as const) {
      if (file) await fs.writeFile(path.join(directory, file), 'excluded');
      const result = spawnSync('/bin/sh', ['-c', script], {
        encoding: 'utf8',
        env: { ...process.env, E2E_MARKER: argument },
      });
      assert.ifError(result.error);
      const shouldPass = !file && argument === marker;
      assert.equal(result.status, shouldPass ? 0 : 1, file ?? `argument=${argument}`);
      assert.equal(result.stdout.trim(), shouldPass ? `ACR_E2E_SOURCE_OK:${marker}` : '');
      if (file) await fs.rm(path.join(directory, file));
    }
  }
);
