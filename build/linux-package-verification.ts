// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type LinuxArch = 'x64' | 'arm64';

/** Match the pinned appInfo/FPM version calculation, not the filename's fixed -1. */
export function expectedLinuxDebVersion(version: string, env: NodeJS.ProcessEnv = process.env): string {
  const iteration = ['BUILD_NUMBER', 'TRAVIS_BUILD_NUMBER', 'APPVEYOR_BUILD_NUMBER',
    'CIRCLE_BUILD_NUM', 'BUILD_BUILDNUMBER', 'CI_PIPELINE_IID'].map(key => env[key]).find(Boolean);
  return version.replace(/-/g, '~') + (iteration ? '-' + iteration.replace(/-/g, '_') : '');
}

export function parseLinuxDebControl(control: string): { architecture: string; version: string } {
  const fields = new Map<string, string>();
  for (const line of control.split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue;
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Malformed DEB control line: ${line}`);
    if (fields.has(match[1])) throw new Error(`Duplicate DEB control field: ${match[1]}`);
    fields.set(match[1], match[2]);
  }
  for (const key of ['Architecture', 'Version']) {
    if (!fields.get(key)) throw new Error(`Missing DEB control ${key}`);
  }
  return { architecture: fields.get('Architecture')!, version: fields.get('Version')! };
}

/** Read only ar headers; large data members stay on disk. */
export function readArMembers(file: string): Array<{ name: string; size: number; offset: number }> {
  const fd = fs.openSync(file, 'r');
  try {
    const length = fs.fstatSync(fd).size;
    const magic = Buffer.alloc(8);
    fs.readSync(fd, magic, 0, 8, 0);
    if (magic.toString() !== '!<arch>\n') throw new Error(`Invalid ar archive: ${file}`);
    const members: Array<{ name: string; size: number; offset: number }> = [];
    for (let offset = 8; offset < length;) {
      const header = Buffer.alloc(60);
      if (fs.readSync(fd, header, 0, 60, offset) !== 60) throw new Error('Truncated ar header');
      if (header.subarray(58).toString() !== '`\n') throw new Error('Malformed ar header');
      const sizeText = header.subarray(48, 58).toString().trim();
      const size = Number(sizeText);
      if (!/^\d+$/.test(sizeText) || !Number.isSafeInteger(size)) throw new Error('Invalid ar member size');
      const end = offset + 60 + size + size % 2;
      if (end > length) throw new Error('Truncated ar member');
      const name = header.subarray(0, 16).toString().trim().replace(/\/$/, '');
      if (!/^[\w.-]+$/.test(name)) throw new Error(`Unsupported ar member name: ${name}`);
      members.push({ name, size, offset: offset + 60 });
      offset = end;
    }
    return members;
  } finally { fs.closeSync(fd); }
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

/** Package-absolute links refer to the extraction root, never the build host. */
function resolvePayloadPath(root: string, file: string): string {
  let pending = path.relative(root, file).split(path.sep);
  let current = root;
  let links = 0;
  while (pending.length) {
    current = path.resolve(current, pending.shift()!);
    if (!inside(root, current)) throw new Error(`Payload link escapes root: ${file}`);
    if (fs.lstatSync(current).isSymbolicLink()) {
      if (++links > 40) throw new Error(`Payload link cycle: ${file}`);
      const target = fs.readlinkSync(current);
      const next = path.isAbsolute(target) ? path.join(root, target) : path.resolve(path.dirname(current), target);
      if (!inside(root, next)) throw new Error(`Payload link escapes root: ${file}`);
      pending = [...path.relative(root, next).split(path.sep), ...pending];
      current = root;
    }
  }
  return current;
}

export function verifyLinuxElfTree(root: string, arch: LinuxArch): { files: string[] } {
  root = path.resolve(root);
  const machine = arch === 'x64' ? 62 : arch === 'arm64' ? 183 : 0;
  if (!machine) throw new Error(`Unsupported Linux architecture: ${arch}`);
  const files: string[] = [];
  const seen = new Set<string>();
  function inspect(file: string): void {
    let resolved: string;
    try { resolved = resolvePayloadPath(root, file); }
    catch (error) { console.warn(`Unneeded payload link: ${path.relative(root, file)}: ${error}`); return; }
    const stat = fs.statSync(resolved);
    // Do not walk directory links (including links back into the payload).
    if (!stat.isFile() || seen.has(resolved)) return;
    seen.add(resolved);
    const header = Buffer.alloc(64);
    const fd = fs.openSync(resolved, 'r');
    let bytes: number;
    try { bytes = fs.readSync(fd, header, 0, 64, 0); } finally { fs.closeSync(fd); }
    if (bytes < 4 || header.subarray(0, 4).toString('hex') !== '7f454c46') return;
    const relative = path.relative(root, resolved);
    if (bytes < 64 || header[4] !== 2 || header[5] !== 1 || header[6] !== 1 ||
      ![1, 2, 3, 4].includes(header.readUInt16LE(16)) ||
      header.readUInt32LE(20) !== 1 || header.readUInt16LE(52) !== 64) {
      throw new Error(`Invalid ELF64 little-endian header: ${relative}`);
    }
    const actual = header.readUInt16LE(18);
    if (actual !== machine) throw new Error(`ELF ${relative}: machine ${actual}, expected ${machine}`);
    files.push(relative);
  }
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, entry);
      if (fs.lstatSync(file).isDirectory()) walk(file); else inspect(file);
    }
  }
  walk(root);
  if (!files.length) throw new Error(`No ELF files in ${root}`);
  return { files: files.sort() };
}

export function verifyLinuxApp(root: string, arch: LinuxArch, version?: string, payloadRoot = root): { files: string[] } {
  root = path.resolve(root);
  payloadRoot = path.resolve(payloadRoot);
  const cli = 'resources/external-tools/az-cli/linux';
  const required = ['aks-desktop', 'resources/headlamp-server', 'resources/app-build-manifest.json',
    `${cli}/bin/az-wrapper`, `${cli}/python/bin/python3`, `${cli}/libexec/bin/az`];
  function requireFile(relative: string): void {
    try {
      if (!fs.statSync(resolvePayloadPath(payloadRoot, path.join(root, relative))).isFile()) throw new Error('Not a file');
    } catch (error) { throw new Error(`Missing/escaping required payload path ${relative}: ${error}`); }
  }
  required.forEach(requireFile);
  let libs: string[];
  try { libs = fs.readdirSync(resolvePayloadPath(payloadRoot, path.join(root, cli, 'python/lib'))); }
  catch (error) { throw new Error(`Missing required libpython directory: ${error}`); }
  const libpython = libs.filter(name => /^libpython.*\.so(?:\.|$)/.test(name));
  if (!libpython.length) throw new Error('Missing required libpython shared library');
  libpython.forEach(name => { requireFile(`${cli}/python/lib/${name}`); });
  const manifest = JSON.parse(fs.readFileSync(resolvePayloadPath(payloadRoot, path.join(root, required[2])), 'utf8'));
  if (manifest.product?.name !== 'aks-desktop' || (version && manifest.product?.version !== version)) {
    throw new Error(`Packaged product identity/version mismatch: expected aks-desktop ${version}`);
  }
  const inventory = verifyLinuxElfTree(payloadRoot, arch);
  for (const relative of [required[0], required[1], required[4], ...libpython.map(name => `${cli}/python/lib/${name}`)]) {
    const resolved = resolvePayloadPath(payloadRoot, path.join(root, relative));
    if (!inventory.files.includes(path.relative(payloadRoot, resolved))) throw new Error(`Required binary is not ELF: ${relative}`);
  }
  return inventory;
}

function artifactNames(version: string, arch: LinuxArch): string[] {
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error(`Invalid package version: ${version}`);
  if (arch !== 'x64' && arch !== 'arm64') throw new Error(`Unsupported Linux architecture: ${arch}`);
  return [`aks-desktop_${version}-1_${arch === 'x64' ? 'amd64' : 'arm64'}.deb`,
    `aks-desktop-${version}-linux-${arch}.tar.gz`];
}

function extract(archive: string, target: string): void {
  fs.mkdirSync(target);
  // Production never skips missing tar/compression support or failed extraction.
  const listing = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  for (const name of listing.split('\n').filter(Boolean)) {
    if (path.posix.isAbsolute(name) || name.split('/').includes('..')) throw new Error(`Unsafe archive path: ${name}`);
  }
  execFileSync('tar', ['-xf', archive, '-C', target], { stdio: 'pipe' });
}

function extractMember(deb: string, prefix: string, scratch: string): string {
  const matches = readArMembers(deb).filter(member => new RegExp(`^${prefix}\\.tar(?:\\.gz|\\.xz)?$`).test(member.name));
  if (matches.length !== 1) throw new Error(`Expected exactly one ${prefix}.tar[.gz/.xz] DEB member`);
  const member = matches[0];
  const archive = path.join(scratch, member.name);
  const input = fs.openSync(deb, 'r');
  const output = fs.openSync(archive, 'w');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let copied = 0;
    while (copied < member.size) {
      const count = fs.readSync(input, buffer, 0, Math.min(buffer.length, member.size - copied), member.offset + copied);
      if (!count) throw new Error('Truncated DEB member');
      fs.writeSync(output, buffer, 0, count); copied += count;
    }
  } finally { fs.closeSync(input); fs.closeSync(output); }
  const target = path.join(scratch, prefix);
  extract(archive, target);
  return target;
}

function inspectPayload(root: string, arch: LinuxArch, version: string): void {
  // Discover the app by its assembled manifest, not a guessed /opt installation prefix.
  const apps: string[] = [];
  function find(dir: string): void {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.lstatSync(file).isDirectory()) find(file);
      else if (name === 'app-build-manifest.json' && path.basename(dir) === 'resources') apps.push(path.dirname(dir));
    }
  }
  find(root);
  if (apps.length !== 1) throw new Error(`Expected one packaged app, found ${apps.length}`);
  const inventory = verifyLinuxApp(apps[0], arch, version, root);
  console.log(`ELF inventory ${arch} (${root}):\n${inventory.files.join('\n')}`);
}

/** Only dedicated staging folders are strict about extras; never point this at raw dist. */
export function verifyLinuxArtifacts(dir: string, version: string, arches: LinuxArch[], env: NodeJS.ProcessEnv = process.env): void {
  if (!arches.length || new Set(arches).size !== arches.length) throw new Error('Specify distinct Linux architectures');
  const expected = arches.flatMap(arch => artifactNames(version, arch));
  const actual = fs.readdirSync(dir);
  const extras = actual.filter(name => !expected.includes(name));
  if (extras.length) throw new Error(`Unexpected staging artifacts: ${extras.join(', ')}`);
  for (const name of expected) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error(`Missing artifact: ${name}`);
    if (!fs.lstatSync(file).isFile() || !fs.statSync(file).size) throw new Error(`Empty/non-file artifact: ${name}`);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-linux-artifacts-'));
  try {
    for (const arch of arches) {
      const [debName, tarName] = artifactNames(version, arch);
      const work = path.join(scratch, arch); fs.mkdirSync(work);
      const deb = path.join(dir, debName);
      const markers = readArMembers(deb).filter(member => member.name === 'debian-binary');
      if (markers.length !== 1 || markers[0].size !== 4) throw new Error('Missing/invalid debian-binary Debian format marker');
      const marker = Buffer.alloc(4);
      const fd = fs.openSync(deb, 'r');
      try { fs.readSync(fd, marker, 0, 4, markers[0].offset); } finally { fs.closeSync(fd); }
      if (marker.toString() !== '2.0\n') throw new Error('Invalid debian-binary Debian format marker');
      const controlRoot = extractMember(deb, 'control', work);
      const controlPath = path.join(controlRoot, 'control');
      if (!fs.lstatSync(controlPath).isFile()) throw new Error('DEB control must be a regular file');
      const control = parseLinuxDebControl(fs.readFileSync(controlPath, 'utf8'));
      const expectedArch = arch === 'x64' ? 'amd64' : 'arm64';
      if (control.architecture !== expectedArch) throw new Error(`DEB Architecture ${control.architecture}, expected ${expectedArch}`);
      const expectedVersion = expectedLinuxDebVersion(version, env);
      if (control.version !== expectedVersion) throw new Error(`DEB Version ${control.version}, expected ${expectedVersion}`);
      inspectPayload(extractMember(deb, 'data', work), arch, version);
      const tarRoot = path.join(work, 'tar'); extract(path.join(dir, tarName), tarRoot);
      inspectPayload(tarRoot, arch, version);
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

export function stageLinuxArtifacts(source: string, dir: string, version: string, arches: LinuxArch[]): void {
  // Verify source selection in a separate directory before copying anything to the collector.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-linux-artifacts-'));
  try {
    const names = arches.flatMap(arch => artifactNames(version, arch));
    for (const name of names) {
      const file = path.join(source, name);
      if (!fs.existsSync(file)) throw new Error(`Missing artifact: ${name}`);
      if (!fs.lstatSync(file).isFile()) throw new Error(`Non-file artifact: ${name}`);
      fs.copyFileSync(file, path.join(scratch, name));
    }
    verifyLinuxArtifacts(scratch, version, arches);
    fs.mkdirSync(dir, { recursive: true });
    names.forEach(name => { fs.copyFileSync(path.join(scratch, name), path.join(dir, name)); });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

/** Isolate native CLI probes from the agent's login state and host extensions. */
export function withLinuxAzureConfig<T>(az: string, action: (env: NodeJS.ProcessEnv) => T): T {
  const extensionDir = path.resolve(path.dirname(az), '../cliextensions');
  if (path.basename(az) !== 'az-wrapper' || !fs.statSync(extensionDir).isDirectory() ||
    !fs.existsSync(path.join(extensionDir, 'connectedk8s'))) throw new Error('Missing bundled connectedk8s extension/wrapper');
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-linux-azure-'));
  try {
    return action({ ...process.env, AZURE_CONFIG_DIR: config, AZURE_EXTENSION_DIR: extensionDir,
      AZURE_CORE_COLLECT_TELEMETRY: 'no', AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no' });
  } finally { fs.rmSync(config, { recursive: true, force: true }); }
}

type ProxyRunner = (file: string, args: string[], options: {
  encoding: 'utf8'; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv;
}) => string;
export function verifyLinuxProxyHelp(az: string, targetArch: string, run: ProxyRunner = execFileSync): string {
  if (process.platform !== 'linux' || process.arch !== targetArch) {
    throw new Error(`Native Linux host required: target ${targetArch}, host ${process.platform}/${process.arch}`);
  }
  return withLinuxAzureConfig(az, env => {
    const help = run(az, ['connectedk8s', 'proxy', '--help'], { encoding: 'utf8',
      timeout: 120000, maxBuffer: 10 * 1024 * 1024, env }).trim();
    if (!/az connectedk8s proxy/.test(help)) throw new Error('Missing connectedk8s proxy help output');
    return help;
  });
}

if (require.main === module) {
  const args = new Map(process.argv.slice(2).map(arg => {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Invalid argument: ${arg}`);
    return [match[1], match[2]];
  }));
  const arches = (args.get('arches') || '').split(',') as LinuxArch[];
  if (args.has('elf-tree')) {
    console.log(verifyLinuxElfTree(args.get('elf-tree')!, arches[0]).files.join('\n'));
  } else {
    const dir = args.get('dir'); const version = args.get('version');
    if (!dir || !version) throw new Error('Required: --dir=PATH --version=VERSION --arches=x64,arm64');
    if (args.has('stage-from')) stageLinuxArtifacts(args.get('stage-from')!, dir, version, arches);
    else verifyLinuxArtifacts(dir, version, arches);
  }
}
