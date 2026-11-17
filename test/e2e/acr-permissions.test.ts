// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import test from 'node:test';
import { createServices, LiveTestPermissionError, type Command } from './acr-services';
import { readConfig } from './acr-workflow';

const env = {
  AKSD_E2E_REPOSITORY: 'example/sandbox',
  AKSD_E2E_BRANCH: 'aksd-acr-e2e',
  AKSD_E2E_ACR_RESOURCE_ID:
    '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/test-rg/providers/Microsoft.ContainerRegistry/registries/testregistry',
  AKSD_E2E_ACR_LOGIN_SERVER: 'testregistry.azurecr.io',
  AKSD_E2E_EXCLUSIVE_REGISTRY: '1',
};
const config = readConfig(env);
const prefix = 'Microsoft.ContainerRegistry/registries/';

function controller(
  write = true,
  permissionResponse: unknown = { value: [{ actions: ['*'] }] },
  abac = false
) {
  const calls: string[][] = [];
  const execute: Command = async (binary, args) => {
    calls.push([binary, ...args]);
    if (binary === 'gh') {
      assert.ok(args.includes('GET'), 'Permission checks must not mutate GitHub');
      if (args[1] === `repos/${config.repository}`) {
        return JSON.stringify({
          default_branch: 'main',
          permissions: { push: write, admin: false },
        });
      }
      if (args[1].includes('/actions/secrets')) return '{"total_count":0,"secrets":[]}';
      if (args[1].includes('/git/ref/')) return '{"object":{"sha":"branch"}}';
      if (args[1].includes('/contents/')) return '{"type":"file"}';
      if (args[1].includes('/actions/workflows/')) return '{"state":"active"}';
    } else if (binary === 'az') {
      if (args[0] === 'acr' && args[1] === 'show') {
        return JSON.stringify({
          loginServer: config.loginServer,
          publicNetworkAccess: 'Enabled',
          roleAssignmentMode: abac ? 'AbacRepositoryPermissions' : 'LegacyRegistryPermissions',
        });
      }
      assert.equal(args[0], 'rest');
      assert.equal(args[args.indexOf('--method') + 1], 'GET');
      assert.match(args[args.indexOf('--url') + 1], /Microsoft.Authorization\/permissions\?/);
      return JSON.stringify(permissionResponse);
    }
    throw new Error(`Unexpected preflight operation: ${binary} ${args.join(' ')}`);
  };
  return {
    calls,
    preflight: () => createServices(config, '/unused', execute).preflight(),
  };
}

test('read-only GitHub access is rejected before Azure reads or remote writes', async () => {
  const client = controller(false);
  await assert.rejects(client.preflight(), error => {
    assert.ok(error instanceof LiveTestPermissionError);
    assert.match(error.message, /Write access/);
    return true;
  });
  assert.equal(client.calls.length, 1);
});

test('a repository writer does not need Admin and all preflight operations are reads', async () => {
  await controller().preflight();
});

for (const missing of [
  'runs/read',
  'runs/listLogSasUrl/action',
  'runs/cancel/action',
  'pull/read',
  'artifacts/delete',
]) {
  test(`preflight identifies missing Azure controller permission ${missing}`, async () => {
    await assert.rejects(
      controller(true, {
        value: [{ actions: ['*'], notActions: [prefix + missing] }],
      }).preflight(),
      error => error instanceof LiveTestPermissionError && error.message.includes(missing)
    );
  });
}

test('grants from separate roles are combined rather than globally subtracting NotActions', async () => {
  await controller(true, {
    value: [
      { actions: ['*'], notActions: [prefix + 'runs/cancel/action'] },
      { actions: [prefix + 'runs/cancel/action'] },
    ],
  }).preflight();
});

test('permission wildcards are case-insensitive and escape literal namespace punctuation', async () => {
  await controller(true, {
    value: [{ actions: ['microsoft.containerregistry/REGISTRIES/*'] }],
  }).preflight();
  await assert.rejects(
    controller(true, {
      value: [{ actions: ['MicrosoftXContainerRegistry/registries/*'] }],
    }).preflight(),
    LiveTestPermissionError
  );
});

test('ABAC registries require image data actions separately from management actions', async () => {
  await assert.rejects(
    controller(true, { value: [{ actions: ['*'] }] }, true).preflight(),
    LiveTestPermissionError
  );
  await controller(
    true,
    {
      value: [{ actions: ['*'], dataActions: [prefix + 'repositories/*'] }],
    },
    true
  ).preflight();
  await assert.rejects(
    controller(
      true,
      {
        value: [
          {
            actions: ['*'],
            dataActions: [prefix + 'repositories/*'],
            notDataActions: [prefix + 'repositories/content/delete'],
          },
        ],
      },
      true
    ).preflight(),
    LiveTestPermissionError
  );
});

test('malformed permission responses are failures, not permission skips', async () => {
  await assert.rejects(controller(true, { value: 'invalid' }).preflight(), error => {
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof LiveTestPermissionError));
    return true;
  });
});

const driver = String.raw`
const cp = require('node:child_process');
const { PassThrough } = require('node:stream');
const mode = process.argv[1];
cp.execFile = (binary, args, options, callback) => {
  let value = {}, diagnostic = '';
  if (binary === 'gh' && args[1] === 'repos/example/sandbox') {
    value = { default_branch: 'main', permissions: { push: mode !== 'reader' } };
    if (mode === 'transport') diagnostic = 'gh: server failure (HTTP 500) private-sensitive-output';
  } else if (binary === 'gh' && args[1].includes('/actions/secrets')) {
    diagnostic = 'gh: Resource not accessible (HTTP 403) private-sensitive-output';
  } else {
    throw new Error('Unexpected operation before permission skip: ' + binary + ' ' + args[0]);
  }
  process.nextTick(() => callback(diagnostic ? { code: 1 } : null, JSON.stringify(value), diagnostic));
  return { stdin: new PassThrough() };
};
require('./test/e2e/acr.live.test.ts');
`;

for (const mode of ['reader', 'secrets', 'transport']) {
  test(`live entry point reports permission skips but preserves service failures (${mode})`, () => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...env,
      AZ_LIVE_TESTS: '1',
    };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--require', 'tsx/cjs', '-e', driver, mode], {
      cwd: path.resolve(__dirname, '../..'),
      env: childEnv,
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, mode === 'transport' ? 1 : 0, result.stdout + result.stderr);
    if (mode === 'transport') assert.doesNotMatch(result.stdout, /SKIP/);
    else assert.match(result.stdout, /SKIP.*controller access/);
    assert.doesNotMatch(result.stdout + result.stderr, /private-sensitive-output/);
  });
}
