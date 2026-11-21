// Copyright (c) Microsoft Corporation.
// Licensed under the Apache License. See LICENSE.

'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const FIRST_PARTY_PATTERNS = [
  /^AKS desktop\.exe$/i,
  /^headlamp-server\.exe$/i,
  /^elevate\.exe$/i,
  /__uninstaller(?:-nsis-[^.]+)?\.exe$/i,
  /^aks-desktop-.+-win-(?:x64|arm64)\.exe$/i,
];
let serviceConnectionIdPromise;

function elevateSha256(manifestPath = path.join(
  __dirname,
  'nsis-aslr',
  'stock-bundle.sha256'
)) {
  const line = fs.readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/)
    .find(value => / {2}elevate\.exe$/.test(value));
  const match = /^([a-f0-9]{64}) {2}elevate\.exe$/.exec(line ?? '');
  if (!match) throw new Error(`Missing elevate.exe checksum in ${manifestPath}`);
  return match[1];
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function isFirstPartyExecutable(filePath) {
  const basename = filePath.split(/[\\/]/).at(-1);
  return FIRST_PARTY_PATTERNS.some(pattern => pattern.test(basename));
}

function allowedSigningTarget(
  file,
  outputRoot,
  expectedElevateSha256 = elevateSha256()
) {
  const realRoot = fs.realpathSync(outputRoot);
  const originalStat = fs.lstatSync(file);
  if (!originalStat.isFile() || originalStat.nlink !== 1) return false;
  const realFile = fs.realpathSync(file);
  const relative = path.relative(realRoot, realFile);
  const insideOutput =
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`);
  const normalized = insideOutput
    ? relative.split(path.sep).join('/')
    : undefined;
  if (
    normalized &&
    isFirstPartyExecutable(normalized) &&
    (
      /^(?:win-[^/]+\/)?AKS desktop\.exe$/i.test(normalized) ||
      /^(?:win-[^/]+\/)?resources\/headlamp-server\.exe$/i.test(normalized) ||
      /^(?:win-[^/]+\/)?resources\/elevate\.exe$/i.test(normalized) ||
      /^aks-desktop-[^/]+__uninstaller(?:-nsis-[^/.]+)?\.exe$/i.test(normalized) ||
      /^aks-desktop-[^/]+-win-(?:x64|arm64)\.exe$/i.test(normalized)
    )
  ) return realFile;
  const parent = path.basename(path.dirname(realFile));
  const staging = path.basename(path.dirname(path.dirname(realFile)));
  if (
    path.basename(realFile).toLowerCase() === 'elevate.exe' &&
    parent === 'resources' &&
    /^elevate-staging-/.test(staging) &&
    createHash('sha256').update(fs.readFileSync(realFile)).digest('hex') === expectedElevateSha256
  ) return realFile;
  return false;
}

async function resolveServiceConnectionId(
  fetchImpl = fetch,
  env = process.env
) {
  const collectionUri = env.SYSTEM_COLLECTIONURI;
  const projectId = env.SYSTEM_TEAMPROJECTID;
  const token = env.SYSTEM_ACCESSTOKEN;
  const endpointName = env.AKSD_ESRP_SERVICE_CONNECTION;
  assert.ok(collectionUri, 'Missing SYSTEM_COLLECTIONURI');
  assert.ok(projectId, 'Missing SYSTEM_TEAMPROJECTID');
  assert.ok(token, 'Missing SYSTEM_ACCESSTOKEN');
  assert.ok(endpointName, 'Missing AKSD_ESRP_SERVICE_CONNECTION');

  const url = new URL(
    `${projectId}/_apis/serviceendpoint/endpoints`,
    collectionUri
  );
  url.searchParams.set('endpointNames', endpointName);
  url.searchParams.set('api-version', '7.1-preview.4');
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(
      `Unable to resolve ESRP service connection (${response.status} ${response.statusText})`
    );
  }
  const body = await response.json();
  if (!Array.isArray(body.value) || body.value.length !== 1) {
    throw new Error(
      `Expected one ESRP service connection named ${endpointName}, found ${body.value?.length ?? 0}`
    );
  }
  if (!body.value[0].id) {
    throw new Error(`ESRP service connection ${endpointName} has no id`);
  }
  return body.value[0].id;
}

function signingOperations() {
  return [
    {
      keyCode: 'CP-231522',
      operationSetCode: 'SigntoolSign',
      parameters: [
        { parameterName: 'OpusName', parameterValue: 'Microsoft' },
        { parameterName: 'OpusInfo', parameterValue: 'http://www.microsoft.com' },
        { parameterName: 'Append', parameterValue: '/as' },
        { parameterName: 'FileDigest', parameterValue: '/fd "SHA256"' },
        { parameterName: 'PageHash', parameterValue: '/NPH' },
        {
          parameterName: 'TimeStamp',
          parameterValue:
            '/tr "http://rfc3161.gtm.corp.microsoft.com/TSS/HttpTspServer" /td sha256',
        },
      ],
      toolName: 'sign',
      toolVersion: '1.0',
    },
    {
      keyCode: 'CP-231522',
      operationSetCode: 'SigntoolVerify',
      parameters: [{ parameterName: 'VerifyAll', parameterValue: '/all' }],
      toolName: 'sign',
      toolVersion: '1.0',
    },
  ];
}

function esrpArguments(filePath, serviceConnectionId, env = process.env) {
  const cliPath = env.AKSD_ESRP_CLI_DLL_PATH;
  assert.ok(cliPath, 'Missing AKSD_ESRP_CLI_DLL_PATH');
  const clientId = env.AKSD_ESRP_APP_REGISTRATION_CLIENT_ID;
  const tenantId = env.AKSD_ESRP_TENANT_ID;
  const esrpClientId = env.AKSD_ESRP_CLIENT_ID;
  const akvName = env.AKSD_ESRP_AKV_NAME;
  const certName = env.AKSD_ESRP_CERT_NAME;
  const dotnetVersion = env.AKSD_ESRP_DOTNET_VERSION;
  assert.ok(clientId, 'Missing AKSD_ESRP_APP_REGISTRATION_CLIENT_ID');
  assert.ok(tenantId, 'Missing AKSD_ESRP_TENANT_ID');
  assert.ok(esrpClientId, 'Missing AKSD_ESRP_CLIENT_ID');
  assert.ok(akvName, 'Missing AKSD_ESRP_AKV_NAME');
  assert.ok(certName, 'Missing AKSD_ESRP_CERT_NAME');
  assert.ok(dotnetVersion, 'Missing AKSD_ESRP_DOTNET_VERSION');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aksd-esrp-'));
  const patternPath = path.join(temporary, 'pattern.txt');
  const parametersPath = path.join(temporary, 'parameters.json');
  fs.writeFileSync(patternPath, filePath.split(/[\\/]/).at(-1));
  fs.writeFileSync(parametersPath, JSON.stringify(signingOperations()));
  const federatedTokenData = {
    jobId: env.SYSTEM_JOBID,
    planId: env.SYSTEM_PLANID,
    projectId: env.SYSTEM_TEAMPROJECTID,
    hub: env.SYSTEM_HOSTTYPE,
    uri: env.SYSTEM_COLLECTIONURI,
    managedIdentityId: clientId,
    managedIdentityTenantId: tenantId,
    serviceConnectionId,
    systemAccessTokenSource: 'stdin',
  };
  const cliVersion = path.basename(path.dirname(path.dirname(cliPath)));

  return {
    args: [
      cliPath,
      'vsts.sign',
      '-a',
      clientId,
      '-d',
      tenantId,
      '-k',
      JSON.stringify({ akv: akvName }),
      '-z',
      JSON.stringify({ akv: akvName, cert: certName }),
      '-f',
      path.dirname(filePath),
      '-p',
      patternPath,
      '-u',
      'false',
      '-x',
      'regularSigning',
      '-b',
      'input.json',
      '-l',
      'AzSecPack_PublisherPolicyProd.xml',
      '-y',
      'inlineSignParams',
      '-j',
      parametersPath,
      '-c',
      '9997',
      '-t',
      '45',
      '-g',
      '10',
      '-v',
      'Tls12',
      '-s',
      'https://api.esrp.microsoft.com/api/v2',
      '-m',
      '0',
      '-o',
      'Microsoft',
      '-i',
      'http://www.microsoft.com',
      '-n',
      '5',
      '-r',
      'true',
      '-w',
      dotnetVersion,
      '-skipAdoReportAttachment',
      'false',
      '-pendingAnalysisWaitTimeoutMinutes',
      '5',
      '-adoTaskVersion',
      cliVersion,
      '-resourceUri',
      'https://msazurecloud.onmicrosoft.com/api.esrp.microsoft.com',
      '-esrpClientId',
      esrpClientId,
      '-useMSIAuthentication',
      'true',
      '-federatedTokenData',
      JSON.stringify(federatedTokenData),
    ],
    temporary,
  };
}

function runEsrp(
  filePath,
  serviceConnectionId,
  env = process.env,
  spawn = childProcess.spawn
) {
  const { args, temporary } = esrpArguments(
    filePath,
    serviceConnectionId,
    env
  );
  const childEnv = { ...env };
  for (const name of Object.keys(childEnv)) {
    if (
      [
        'SYSTEM_ACCESSTOKEN',
        'ENDPOINT_AUTH_SYSTEMVSSCONNECTION',
        'ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN',
      ].includes(name.toUpperCase())
    ) {
      delete childEnv[name];
    }
  }
  const child = spawn('dotnet', args, {
    env: childEnv,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  return new Promise((resolve, reject) => {
    child.once('error', error => {
      fs.rmSync(temporary, { recursive: true, force: true });
      reject(error);
    });
    child.once('close', code => {
      fs.rmSync(temporary, { recursive: true, force: true });
      if (code === 0) resolve();
      else reject(new Error(`ESRP signing failed for ${filePath} (${code})`));
    });
    child.stdin.end(`${env.SYSTEM_ACCESSTOKEN}\n`);
  });
}

async function sign(filePath) {
  if (!isFirstPartyExecutable(filePath)) {
    console.log(`Leaving third-party executable unsigned: ${filePath}`);
    return;
  }
  if (process.env.AKSD_ESRP_BROKER_URL) {
    const body = JSON.stringify({ file: path.resolve(filePath) });
    await new Promise((resolve, reject) => {
      const request = http.request(`${process.env.AKSD_ESRP_BROKER_URL}/sign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${requireEnvironment('AKSD_ESRP_BROKER_TOKEN')}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.once('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(
              `Signing broker rejected ${filePath}: ${response.statusCode} ${Buffer.concat(chunks).toString('utf8')}`
            ));
          }
        });
      });
      request.once('error', reject);
      request.end(body);
    });
    return;
  }
  if (!process.env.AKSD_ESRP_CLI_DLL_PATH) {
    if (process.env.AKSD_ESRP_REQUIRED === 'true') {
      throw new Error(`Required ESRP configuration is unavailable for ${filePath}`);
    }
    return;
  }

  serviceConnectionIdPromise ??= resolveServiceConnectionId();
  const serviceConnectionId = await serviceConnectionIdPromise;
  console.log(`Signing ${filePath}`);
  await runEsrp(path.resolve(filePath), serviceConnectionId);
}

module.exports = {
  allowedSigningTarget,
  elevateSha256,
  esrpArguments,
  isFirstPartyExecutable,
  resolveServiceConnectionId,
  runEsrp,
  sign,
  signingOperations,
};

if (require.main === module) {
  sign(requireEnvironment('AKSD_ESRP_FILE')).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
