// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assertNativeMacHost, type MacVerificationHost } from './macos-bundle-verification';

export type MacRuntimeRunner = (
  command: string,
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding
) => string;

export interface MacRuntimeOptions {
  targetArch: string;
  expectedCliVersion: string;
  requiredExtensions: string[];
}

export interface MacRuntimeEvidence {
  pythonVersion: string;
  pythonMachine: string;
  azureCliVersion: string;
  imports: Record<string, string>;
  extensions: Record<string, string>;
  loadedExtensionCommands: string[];
}

// Commands confirmed in azure-cli-extensions src/<extension>/azext_*/commands.py.
// Use command help, not group help: it loads the command's arguments/custom code.
const EXTENSION_COMMANDS: Record<string, string[]> = {
  'resource-graph': ['graph', 'query'],
  alertsmanagement: ['monitor', 'alert-processing-rule', 'list'],
  connectedk8s: ['connectedk8s', 'list'],
};
const IMPORTS = [
  'ssl',
  'sqlite3',
  'ctypes',
  'azure.cli.core',
  'cryptography',
  'psutil',
  'OpenSSL',
  'requests',
  'msal',
];
const PYTHON_PROBE = `
import importlib, json, os, platform, sys
modules = {name: importlib.import_module(name) for name in json.loads(sys.argv[1])}
# Exercise native bindings, not just their pure-Python package initializers.
modules['ssl'].create_default_context()
with modules['sqlite3'].connect(':memory:') as db:
    assert db.execute('select 1').fetchone() == (1,)
modules['ctypes'].CDLL(None)
from cryptography.hazmat.primitives import hashes
assert len(hashes.Hash(hashes.SHA256()).finalize()) == 32
assert modules['psutil'].Process().pid == os.getpid()
modules['OpenSSL'].SSL.Context(modules['OpenSSL'].SSL.TLS_CLIENT_METHOD)
modules['requests'].Session().close()
print(json.dumps({'version': platform.python_version(), 'machine': platform.machine(),
    'executable': os.path.realpath(sys.executable),
    'modules': {name: os.path.realpath(module.__file__) for name, module in modules.items()}}))
`;

/** Offline, bounded native-runtime checks; call the full Mach-O audit separately. */
export function verifyMacBundleRuntime(
  appDirectory: string,
  options: MacRuntimeOptions,
  run: MacRuntimeRunner = (command, args, execution) => execFileSync(command, args, execution),
  host: MacVerificationHost = process
): MacRuntimeEvidence {
  assertNativeMacHost(
    options.targetArch,
    (command, args) =>
      run(command, args, {
        encoding: 'utf8',
        timeout: 30000,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      }),
    host
  );
  if (!options.expectedCliVersion.trim()) throw new Error('Azure CLI version pin is required');
  const requiredExtensions = [...new Set(options.requiredExtensions)];
  for (const name of requiredExtensions) {
    if (!Object.hasOwn(EXTENSION_COMMANDS, name))
      throw new Error(`No extension command probe for ${name}`);
  }
  const root = fs.realpathSync(appDirectory);
  function confined(file: string, boundary = root): string {
    const resolved = fs.realpathSync(file);
    const relative = path.relative(boundary, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Runtime payload escapes bundle: ${file}`);
    }
    return resolved;
  }
  const cli = confined(path.join(root, 'Contents/Resources/external-tools/az-cli/darwin'));
  const python = path.join(cli, 'bin/python3');
  const expectedPython = confined(python, cli);
  const extensionDirectory = confined(path.join(cli, 'cliextensions'), cli);
  const visited = new Set<string>();
  function checkLinks(file: string): void {
    const resolved = confined(file, cli);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    if (fs.statSync(resolved).isDirectory()) {
      for (const entry of fs.readdirSync(resolved)) checkLinks(path.join(resolved, entry));
    }
  }
  checkLinks(cli);
  for (const name of requiredExtensions) confined(path.join(extensionDirectory, name), cli);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-mac-runtime-'));
  try {
    const execution: ExecFileSyncOptionsWithStringEncoding = {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      cwd: scratch,
      // Allowlist: never inherit credentials, Python/DYLD injection, extension
      // development paths, or the user's CLI config/cache. No writes to the app.
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: scratch,
        AZURE_CONFIG_DIR: path.join(scratch, 'azure'),
        AZURE_EXTENSION_DIR: extensionDirectory,
        AZURE_EXTENSION_SYS_DIR: path.join(scratch, 'system-extensions'),
        AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no',
        AZURE_CORE_COLLECT_TELEMETRY: 'no',
        AZURE_CORE_CHECK_VERSION: 'no',
        AZURE_CORE_NO_COLOR: 'true',
      },
    };
    const invoke = (args: string[]) => run(python, ['-I', '-B', ...args], execution).trim();
    const pythonData = JSON.parse(invoke(['-c', PYTHON_PROBE, JSON.stringify(IMPORTS)]));
    const machine = options.targetArch === 'x64' ? 'x86_64' : 'arm64';
    if (pythonData?.machine !== machine)
      throw new Error(
        `Bundled Python architecture ${pythonData?.machine} does not match ${machine}`
      );
    if (
      typeof pythonData.executable !== 'string' ||
      path.resolve(pythonData.executable) !== expectedPython
    ) {
      throw new Error(`Bundled Python executable mismatch: ${pythonData.executable}`);
    }
    if (typeof pythonData.version !== 'string' || !/^3\.\d+\.\d+$/.test(pythonData.version)) {
      throw new Error('Bundled Python returned an invalid version');
    }
    const imports: Record<string, string> = {};
    for (const name of IMPORTS) {
      const file = pythonData.modules?.[name];
      if (typeof file !== 'string' || !path.isAbsolute(file))
        throw new Error(`Missing bundled Python module origin: ${name}`);
      imports[name] = confined(file, cli);
    }

    // The exact interpreter/module pair cannot fall back to an ambient az.
    const version = JSON.parse(invoke(['-m', 'azure.cli', 'version', '--output', 'json']));
    if (version?.['azure-cli'] !== options.expectedCliVersion) {
      throw new Error(
        `Bundled Azure CLI version ${version?.['azure-cli']} does not match ${options.expectedCliVersion}`
      );
    }
    const extensions = version.extensions;
    if (
      !extensions ||
      typeof extensions !== 'object' ||
      Array.isArray(extensions) ||
      Object.values(extensions).some((value) => typeof value !== 'string' || !value)
    ) {
      throw new Error('Invalid bundled Azure CLI extensions metadata');
    }
    if (Object.hasOwn(extensions, 'aks-preview'))
      throw new Error('Forbidden aks-preview extension is bundled');
    for (const name of requiredExtensions) {
      if (!Object.hasOwn(extensions, name)) throw new Error(`Missing required extension: ${name}`);
    }
    const loadedExtensionCommands: string[] = [];
    for (const name of requiredExtensions) {
      const command = EXTENSION_COMMANDS[name];
      const commandName = command.join(' ');
      const help = invoke(['-m', 'azure.cli', ...command, '--help']);
      if (!new RegExp(`^\\s*az ${commandName}\\s*:`, 'm').test(help)) {
        throw new Error(`Extension command help did not load ${commandName}`);
      }
      loadedExtensionCommands.push(commandName);
    }
    return {
      pythonVersion: pythonData.version,
      pythonMachine: pythonData.machine,
      azureCliVersion: version['azure-cli'],
      imports,
      extensions,
      loadedExtensionCommands,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
