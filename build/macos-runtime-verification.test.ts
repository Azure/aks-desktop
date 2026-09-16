// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test, { type TestContext } from 'node:test';
import { verifyMacBundleRuntime, type MacRuntimeRunner } from './macos-runtime-verification';

const host = { platform: 'darwin', arch: 'arm64' };
const options = {
  targetArch: 'arm64',
  expectedCliVersion: '2.89.0',
  requiredExtensions: ['resource-graph', 'alertsmanagement', 'connectedk8s'],
};
const commands = ['graph query', 'monitor alert-processing-rule list', 'connectedk8s list'];

function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac runtime-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.join(root, 'Contents/Resources/external-tools/az-cli/darwin');
  const python = path.join(cli, 'bin/python3');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, Buffer.from('cffaedfe0c000001', 'hex'), { mode: 0o755 });
  fs.mkdirSync(path.join(cli, 'cliextensions'), { recursive: true });
  for (const extension of options.requiredExtensions)
    fs.mkdirSync(path.join(cli, 'cliextensions', extension));
  const modules = Object.fromEntries(
    [
      'ssl',
      'sqlite3',
      'ctypes',
      'azure.cli.core',
      'cryptography',
      'psutil',
      'OpenSSL',
      'requests',
      'msal',
    ].map((name) => {
      const file = path.join(cli, 'lib', `${name}.py`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '# fixture');
      return [name, file];
    })
  );
  const pythonData = { version: '3.10.19', machine: 'arm64', executable: python, modules };
  const versionData = {
    'azure-cli': '2.89.0',
    'azure-cli-core': '2.89.0',
    'azure-cli-telemetry': '1.1.0',
    extensions: { 'resource-graph': '2.1.0', alertsmanagement: '1.0.1', connectedk8s: '1.12.0' },
  };
  const calls: string[][] = [];
  let scratch = '';
  const run: MacRuntimeRunner = (command, args, execution) => {
    if (command === '/usr/sbin/sysctl') return '0';
    assert.equal(command, python, 'never resolve ambient az/python or run an unverified wrapper');
    assert.deepEqual(args.slice(0, 2), ['-I', '-B']);
    assert.equal(execution.timeout, 120000);
    assert.equal(execution.maxBuffer, 10 * 1024 * 1024);
    assert.equal(execution.env?.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
    assert.equal(execution.env?.AZURE_EXTENSION_DIR, path.join(cli, 'cliextensions'));
    assert.equal(execution.env?.AZURE_EXTENSION_USE_DYNAMIC_INSTALL, 'no');
    assert.equal(execution.env?.AZURE_CORE_COLLECT_TELEMETRY, 'no');
    assert.equal(execution.env?.AZURE_CORE_CHECK_VERSION, 'no');
    for (const ambient of [
      'PYTHONPATH',
      'PYTHONHOME',
      'AZURE_CLIENT_SECRET',
      'AZURE_EXTENSION_DEV_SOURCES',
      'DYLD_LIBRARY_PATH',
    ])
      assert.equal(execution.env?.[ambient], undefined);
    scratch = execution.env!.HOME!;
    assert.notEqual(scratch, os.homedir());
    assert.equal(execution.cwd, scratch);
    assert.ok(fs.existsSync(scratch));
    assert.equal(execution.env?.AZURE_CONFIG_DIR, path.join(scratch, 'azure'));
    calls.push(args);
    if (args[2] === '-c') {
      assert.deepEqual(JSON.parse(args[4]), [
        'ssl',
        'sqlite3',
        'ctypes',
        'azure.cli.core',
        'cryptography',
        'psutil',
        'OpenSSL',
        'requests',
        'msal',
      ]);
      return JSON.stringify(pythonData);
    }
    assert.deepEqual(args.slice(2, 4), ['-m', 'azure.cli']);
    if (args[4] === 'version') {
      assert.deepEqual(args.slice(4), ['version', '--output', 'json']);
      return JSON.stringify(versionData);
    }
    assert.equal(args.at(-1), '--help');
    const commandName = args.slice(4, -1).join(' ');
    assert.ok(commands.includes(commandName), `unexpected CLI command ${commandName}`);
    return `Command\n    az ${commandName} : Fixture help.\nArguments\n`;
  };
  return { root, cli, python, pythonData, versionData, calls, run, scratch: () => scratch };
}

test('runs exact bundled Python and CLI with isolated native imports and real extension command help', (t) => {
  const f = fixture(t);
  const result = verifyMacBundleRuntime(f.root, options, f.run, host);
  assert.equal(result.pythonVersion, '3.10.19');
  assert.equal(result.pythonMachine, 'arm64');
  assert.equal(result.azureCliVersion, '2.89.0');
  assert.deepEqual(result.imports, f.pythonData.modules);
  assert.deepEqual(result.extensions, f.versionData.extensions);
  assert.deepEqual(result.loadedExtensionCommands, commands);
  assert.equal(f.calls.length, 5);
  assert.equal(fs.existsSync(f.scratch()), false, 'remove isolated state');
});

test('fails closed on native import errors and timeouts, and cleans temporary state', (t) => {
  for (const error of [
    new Error('ImportError: incompatible architecture in _ssl.so'),
    new Error('ETIMEDOUT'),
  ]) {
    const f = fixture(t);
    assert.throws(
      () =>
        verifyMacBundleRuntime(
          f.root,
          options,
          (command, args, execution) => {
            const output = f.run(command, args, execution);
            if (command === f.python) throw error;
            return output;
          },
          host
        ),
      new RegExp(error.message)
    );
    assert.equal(fs.existsSync(f.scratch()), false);
  }
});

test('rejects wrong Python architecture, executable, and missing or external module origins', (t) => {
  const f = fixture(t);
  f.pythonData.machine = 'x86_64';
  assert.throws(() => verifyMacBundleRuntime(f.root, options, f.run, host), /Python.*architecture/);
  f.pythonData.machine = 'arm64';
  f.pythonData.executable = '/usr/bin/python3';
  assert.throws(() => verifyMacBundleRuntime(f.root, options, f.run, host), /Python.*executable/);
  f.pythonData.executable = f.python;
  f.pythonData.modules.ssl = __filename;
  assert.throws(() => verifyMacBundleRuntime(f.root, options, f.run, host), /module.*ssl|escapes/);
  delete f.pythonData.modules.ssl;
  assert.throws(() => verifyMacBundleRuntime(f.root, options, f.run, host), /module.*ssl/);
});

test('rejects missing extensions, CLI version drift, and forbidden aks-preview', (t) => {
  const f = fixture(t);
  f.versionData['azure-cli'] = '2.88.0';
  assert.throws(() => verifyMacBundleRuntime(f.root, options, f.run, host), /version.*2.89.0/);
  f.versionData['azure-cli'] = '2.89.0';
  const extensions: Record<string, string> = f.versionData.extensions;
  delete extensions.connectedk8s;
  assert.throws(
    () => verifyMacBundleRuntime(f.root, options, f.run, host),
    /Missing.*connectedk8s/
  );
  extensions.connectedk8s = '1.12.0';
  extensions['aks-preview'] = '1.0.0';
  assert.throws(() => verifyMacBundleRuntime(f.root, options, f.run, host), /aks-preview/);
});

test('does not accept extension metadata when command loading fails or prints generic help', (t) => {
  const f = fixture(t);
  for (const broken of commands) {
    assert.throws(
      () =>
        verifyMacBundleRuntime(
          f.root,
          options,
          (command, args, execution) => {
            if (args.slice(4, -1).join(' ') === broken) throw new Error(`failed loading ${broken}`);
            return f.run(command, args, execution);
          },
          host
        ),
      /failed loading/
    );
  }
  assert.throws(
    () =>
      verifyMacBundleRuntime(
        f.root,
        options,
        (command, args, execution) =>
          args.at(-1) === '--help' ? 'Welcome to Azure CLI' : f.run(command, args, execution),
        host
      ),
    /help.*graph query/
  );
});

test('rejects unknown probe mappings, empty version pins, wrong hosts and malformed output', (t) => {
  const f = fixture(t);
  assert.throws(
    () => verifyMacBundleRuntime(f.root, { ...options, expectedCliVersion: '' }, f.run, host),
    /version pin/
  );
  assert.throws(
    () =>
      verifyMacBundleRuntime(f.root, { ...options, requiredExtensions: ['unknown'] }, f.run, host),
    /No.*probe.*unknown/
  );
  assert.throws(
    () => verifyMacBundleRuntime(f.root, options, f.run, { platform: 'linux', arch: 'arm64' }),
    /native.*host/
  );
  assert.throws(
    () =>
      verifyMacBundleRuntime(
        f.root,
        options,
        (command, args, execution) =>
          command === f.python ? '{}' : f.run(command, args, execution),
        host
      ),
    /Python/
  );
});

test(
  'rejects escaped runtime payload links before invoking Python',
  { skip: process.platform === 'win32' },
  (t) => {
    const f = fixture(t);
    fs.symlinkSync(os.tmpdir(), path.join(f.cli, 'cliextensions', 'escaped'));
    assert.throws(() => verifyMacBundleRuntime(f.root, options, f.run, host), /escapes/);
    assert.equal(f.calls.length, 0);
  }
);
