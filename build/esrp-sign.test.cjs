// Copyright (c) Microsoft Corporation.
// Licensed under the Apache License. See LICENSE.

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { createSigningBroker } = require('./esrp-sign-broker.cjs');
const {
  allowedSigningTarget,
  elevateSha256,
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
  child.stdin = { end: value => { child.stdinValue = value; } };
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

test('allows only canonical files in known Windows output locations', t => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sign target-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const allowed = [
    'win-unpacked/AKS desktop.exe',
    'win-unpacked/resources/headlamp-server.exe',
    'win-unpacked/resources/elevate.exe',
    'aks-desktop-1.2.3-win-x64.__uninstaller.exe',
    'aks-desktop-1.2.3-win-arm64.exe',
  ];
  for (const relative of allowed) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fixture');
    assert.equal(
      allowedSigningTarget(file, root),
      fs.realpathSync(file),
      relative
    );
  }
  const outside = path.join(path.dirname(root), 'AKS desktop.exe');
  fs.writeFileSync(outside, 'fixture');
  t.after(() => fs.rmSync(outside, { force: true }));
  assert.equal(allowedSigningTarget(outside, root), false);
  const wrongDirectory = path.join(root, 'temp', 'AKS desktop.exe');
  fs.mkdirSync(path.dirname(wrongDirectory));
  fs.writeFileSync(wrongDirectory, 'fixture');
  assert.equal(allowedSigningTarget(wrongDirectory, root), false);
  const nestedInstaller = path.join(
    root,
    'nested',
    'aks-desktop-1.2.3-win-x64.exe'
  );
  fs.mkdirSync(path.dirname(nestedInstaller));
  fs.writeFileSync(nestedInstaller, 'fixture');
  assert.equal(allowedSigningTarget(nestedInstaller, root), false);
});

test('allows only the checksum-pinned staged elevation helper', t => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sign elevate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const helper = path.join(root, 'elevate-staging-123', 'resources', 'elevate.exe');
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.writeFileSync(helper, 'fixture');
  fs.mkdirSync(path.join(root, 'dist'));
  const digest = require('node:crypto')
    .createHash('sha256')
    .update('fixture')
    .digest('hex');
  assert.equal(
    allowedSigningTarget(helper, path.join(root, 'dist'), digest),
    fs.realpathSync(helper)
  );
  assert.equal(allowedSigningTarget(helper, path.join(root, 'dist')), false);
});

test('reads the elevation helper digest from the NSIS inventory', () => {
  assert.equal(
    elevateSha256(),
    fs.readFileSync(
      path.join(__dirname, 'nsis-aslr', 'stock-bundle.sha256'),
      'utf8'
    ).match(/^([a-f0-9]{64}) {2}elevate\.exe$/m)[1]
  );
});

test('rejects linked signing targets', { skip: process.platform === 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sign link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'win-unpacked');
  fs.mkdirSync(directory);
  const source = path.join(root, 'source.exe');
  const linked = path.join(directory, 'AKS desktop.exe');
  fs.writeFileSync(source, 'fixture');
  fs.symlinkSync(source, linked);
  assert.equal(allowedSigningTarget(linked, root), false);
});

test('rejects hard-linked signing targets', { skip: process.platform === 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sign link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'win-unpacked');
  fs.mkdirSync(directory);
  const source = path.join(root, 'source.exe');
  const linked = path.join(directory, 'AKS desktop.exe');
  fs.writeFileSync(source, 'fixture');
  fs.linkSync(source, linked);
  assert.equal(allowedSigningTarget(linked, root), false);
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

function request(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...options }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('broker authenticates routes and validates targets before signing', async t => {
  const outputRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'broker output-'));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const target = path.join(outputRoot, 'AKS desktop.exe');
  fs.writeFileSync(target, 'unsigned');
  const signed = [];
  const server = createSigningBroker({
    secret: 'secret',
    outputRoot,
    validateTarget: file => file === target && file,
    signer: async file => {
      assert.equal(isFirstPartyExecutable(file), true);
      signed.push(file);
      fs.appendFileSync(file, ':signed');
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const validBody = JSON.stringify({ file: target });
  assert.equal((await request(port, {
    method: 'GET',
    path: '/sign',
    headers: { authorization: 'Bearer secret' },
  })).status, 404);
  assert.equal((await request(port, {
    method: 'POST',
    path: '/other',
    headers: { authorization: 'Bearer secret' },
  }, validBody)).status, 404);
  assert.equal((await request(port, {
    method: 'POST',
    path: '/sign',
  }, validBody)).status, 401);
  assert.equal((await request(port, {
    method: 'POST',
    path: '/sign',
    headers: { authorization: 'Bearer secret' },
  }, JSON.stringify({ file: '/tmp/AKS desktop.exe' }))).status, 400);
  assert.equal((await request(port, {
    method: 'POST',
    path: '/sign',
    headers: { authorization: 'Bearer secret' },
  }, '{')).status, 400);
  assert.deepEqual(signed, []);
  assert.equal((await request(port, {
    method: 'POST',
    path: '/sign',
    headers: { authorization: 'Bearer secret' },
  }, validBody)).status, 204);
  assert.equal(signed.length, 1);
  assert.notEqual(signed[0], target);
  assert.equal(path.basename(signed[0]), path.basename(target));
  assert.equal(fs.readFileSync(target, 'utf8'), 'unsigned:signed');
});

test('broker never signs replacement bytes after target validation', async t => {
  const outputRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'broker race-'));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const target = path.join(outputRoot, 'AKS desktop.exe');
  fs.writeFileSync(target, 'validated');
  const server = createSigningBroker({
    secret: 'secret',
    outputRoot,
    validateTarget: file => file === target && file,
    signer: async file => {
      assert.equal(fs.readFileSync(file, 'utf8'), 'validated');
      fs.writeFileSync(target, 'replacement');
      fs.appendFileSync(file, ':signed');
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  assert.equal((await request(server.address().port, {
    method: 'POST',
    path: '/sign',
    headers: { authorization: 'Bearer secret' },
  }, JSON.stringify({ file: target }))).status, 204);
  assert.equal(fs.readFileSync(target, 'utf8'), 'validated:signed');
});

test('signing client sends broker headers and body and surfaces errors', async t => {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        authorization: request.headers.authorization,
        method: request.method,
        body: JSON.parse(Buffer.concat(chunks)),
      });
      if (requests.length === 1) {
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end('unavailable');
      } else {
        response.writeHead(204);
        response.end();
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const prior = { ...process.env };
  process.env.AKSD_ESRP_BROKER_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.AKSD_ESRP_BROKER_TOKEN = 'broker-secret';
  t.after(() => Object.assign(process.env, prior));

  await assert.rejects(
    sign('/work/AKS desktop.exe'),
    /Signing broker rejected.*503 unavailable/
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, 'Bearer broker-secret');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].body.file, path.resolve('/work/AKS desktop.exe'));
  await sign('/work/AKS desktop.exe');
  assert.equal(requests.length, 2);
});

test('delivers the job token only through stdin and cleans up after success', async () => {
  const child = fakeChild();
  let invocation;
  const spawn = (command, args, options) => {
    invocation = { command, args, options };
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };

  await runEsrp(
    '/work/AKS desktop.exe',
    'service-connection-id',
    signingEnvironment,
    spawn
  );

  assert.equal(invocation.command, 'dotnet');
  assert.equal(child.stdinValue, 'job-token\n');
  assert.equal(invocation.options.env.SYSTEM_ACCESSTOKEN, undefined);
  assert.equal(
    Object.values(invocation.options.env).some(value => value === 'job-token'),
    false
  );
  assert.equal(
    invocation.args.some(value => value.includes('job-token')),
    false
  );
  assert.equal(
    invocation.args.indexOf('-federatedTokenData') >= 0,
    true
  );
  assert.equal(
    JSON.parse(
      invocation.args[invocation.args.indexOf('-federatedTokenData') + 1]
    ).systemAccessTokenSource,
    'stdin'
  );
  const temporary = path.dirname(invocation.args[invocation.args.indexOf('-p') + 1]);
  assert.equal(fs.existsSync(temporary), false);
});
