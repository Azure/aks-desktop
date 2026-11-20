// Copyright (c) Microsoft Corporation.
// Licensed under the Apache License. See LICENSE.

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  esrpArguments,
  isFirstPartyExecutable,
  resolveServiceConnectionId,
  runEsrp,
  sign,
  signingOperations,
} = require('./esrp-sign.cjs');

const signingEnvironment = {
  AKSD_ESRP_CLI_DLL_PATH: 'C:\\agent\\_tasks\\EsrpCodeSigning\\6.1.3\\net6.0\\esrpcli.dll',
  AKSD_ESRP_APP_REGISTRATION_CLIENT_ID: 'app-client',
  AKSD_ESRP_TENANT_ID: 'tenant',
  AKSD_ESRP_CLIENT_ID: 'esrp-client',
  AKSD_ESRP_AKV_NAME: 'vault',
  AKSD_ESRP_CERT_NAME: 'certificate',
  AKSD_ESRP_DOTNET_VERSION: '6.0.428',
  SYSTEM_JOBID: 'job',
  SYSTEM_PLANID: 'plan',
  SYSTEM_TEAMPROJECTID: 'project',
  SYSTEM_HOSTTYPE: 'build',
  SYSTEM_COLLECTIONURI: 'https://dev.azure.com/example/',
  SYSTEM_ACCESSTOKEN: 'job-token',
};

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = { end: () => undefined };
  return child;
}

test('recognizes AKS Desktop-owned Windows signing targets', () => {
  for (const file of [
    'AKS desktop.exe',
    'headlamp-server.exe',
    'elevate.exe',
    'aks-desktop-0.12.0-win-x64.__uninstaller.exe',
    '__uninstaller-nsis-headlamp.exe',
    'aks-desktop-0.12.0-win-arm64.exe',
  ]) {
    assert.equal(isFirstPartyExecutable(path.join('C:\\build', file)), true, file);
  }
  for (const file of [
    'python.exe',
    'az.exe',
    '7z.exe',
    'signtool.exe',
    'not-aks-desktop.exe',
  ]) {
    assert.equal(isFirstPartyExecutable(path.join('C:\\build', file)), false, file);
  }
});

test('resolves the named ESRP service connection with the job token', async () => {
  let request;
  const id = await resolveServiceConnectionId(
    async (url, options) => {
      request = { url: new URL(url), options };
      return {
        ok: true,
        json: async () => ({ value: [{ id: 'service-connection-id' }] }),
      };
    },
    {
      SYSTEM_COLLECTIONURI: 'https://dev.azure.com/example/',
      SYSTEM_TEAMPROJECTID: 'project-id',
      SYSTEM_ACCESSTOKEN: 'job-token',
      AKSD_ESRP_SERVICE_CONNECTION: 'ESRP-AME-AZCU',
    }
  );
  assert.equal(id, 'service-connection-id');
  assert.equal(
    request.url.toString(),
    'https://dev.azure.com/example/project-id/_apis/serviceendpoint/endpoints?endpointNames=ESRP-AME-AZCU&api-version=7.1-preview.4'
  );
  assert.equal(
    request.options.headers.authorization,
    `Basic ${Buffer.from(':job-token').toString('base64')}`
  );
});

test('rejects ambiguous ESRP service connections', async () => {
  await assert.rejects(
    resolveServiceConnectionId(
      async () => ({
        ok: true,
        json: async () => ({ value: [] }),
      }),
      {
        SYSTEM_COLLECTIONURI: 'https://dev.azure.com/example/',
        SYSTEM_TEAMPROJECTID: 'project-id',
        SYSTEM_ACCESSTOKEN: 'job-token',
        AKSD_ESRP_SERVICE_CONNECTION: 'ESRP-AME-AZCU',
      }
    ),
    /Expected one ESRP service connection.*found 0/
  );
});

test('builds a SHA-256 sign-and-verify request for one executable', t => {
  const { args, temporary } = esrpArguments(
    '/work/AKS desktop.exe',
    'service-connection-id',
    signingEnvironment
  );
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

  assert.equal(args[0], 'C:\\agent\\_tasks\\EsrpCodeSigning\\6.1.3\\net6.0\\esrpcli.dll');
  assert.equal(args[1], 'vsts.sign');
  assert.equal(args[args.indexOf('-s') + 1], 'https://api.esrp.microsoft.com/api/v2');
  assert.equal(args[args.indexOf('-w') + 1], '6.0.428');
  assert.equal(args[args.indexOf('-f') + 1], '/work');
  assert.equal(
    fs.readFileSync(args[args.indexOf('-p') + 1], 'utf8'),
    'AKS desktop.exe'
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(args[args.indexOf('-j') + 1], 'utf8')),
    signingOperations()
  );
  const federated = JSON.parse(args[args.indexOf('-federatedTokenData') + 1]);
  assert.equal(federated.serviceConnectionId, 'service-connection-id');
  assert.equal(federated.systemAccessTokenSource, 'stdin');
});

test('required signing fails before an ESRP session when tooling is missing', async t => {
  const previous = {
    AKSD_ESRP_CLI_DLL_PATH: process.env.AKSD_ESRP_CLI_DLL_PATH,
    AKSD_ESRP_REQUIRED: process.env.AKSD_ESRP_REQUIRED,
  };
  delete process.env.AKSD_ESRP_CLI_DLL_PATH;
  process.env.AKSD_ESRP_REQUIRED = 'true';
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  await assert.rejects(
    sign('/work/AKS desktop.exe'),
    /Required ESRP configuration is unavailable/
  );
});

test('propagates ESRP process spawn errors', async () => {
  const spawnError = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  const child = fakeChild();
  const spawn = () => {
    queueMicrotask(() => child.emit('error', spawnError));
    return child;
  };

  await assert.rejects(
    runEsrp('/work/AKS desktop.exe', 'service-connection-id', signingEnvironment, spawn),
    error => error === spawnError
  );
});

test('rejects nonzero ESRP process exits', async () => {
  const child = fakeChild();
  const spawn = () => {
    queueMicrotask(() => child.emit('close', 23));
    return child;
  };

  await assert.rejects(
    runEsrp('/work/AKS desktop.exe', 'service-connection-id', signingEnvironment, spawn),
    /ESRP signing failed.*\(23\)/
  );
});
