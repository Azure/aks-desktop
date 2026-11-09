// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { afterEach, test } from 'node:test';
import {
  expectedLinuxDebVersion, parseLinuxDebControl, readArMembers,
  verifyLinuxElfTree, verifyLinuxArtifacts, verifyLinuxApp, stageLinuxArtifacts, verifyLinuxProxyHelp,
} from './linux-package-verification';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function temp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-packages-'));
  roots.push(root);
  return root;
}
function put(root: string, file: string, contents: string | Buffer): string {
  const output = path.join(root, file);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, contents);
  return output;
}
function elf(machine = 183): Buffer {
  const data = Buffer.alloc(64);
  data.set([0x7f, 69, 76, 70, 2, 1, 1]);
  data.writeUInt16LE(2, 16);
  data.writeUInt16LE(machine, 18);
  data.writeUInt32LE(1, 20);
  data.writeUInt16LE(64, 52);
  return data;
}
function tar(files: Record<string, Buffer | string>): Buffer {
  const entries = Object.entries(files).flatMap(([name, contents]) => {
    const header = Buffer.alloc(512);
    if (Buffer.byteLength(name) <= 100) header.write(name, 0, 100);
    else {
      header.write(path.posix.basename(name), 0, 100);
      header.write(path.posix.dirname(name), 345, 155);
    }
    const link = typeof contents === 'string' ? contents : undefined;
    if (link) contents = Buffer.alloc(0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(contents.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header[156] = link ? 50 : 48;
    if (link) header.write(link, 157, 100);
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    return [header, contents as Buffer, Buffer.alloc((512 - contents.length % 512) % 512)];
  });
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}
function ar(files: Record<string, Buffer>): Buffer {
  return Buffer.concat([Buffer.from('!<arch>\n'), ...Object.entries(files).flatMap(([name, data]) => {
    const header = `${(name + '/').padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(data.length).padEnd(10)}\x60\n`;
    return [Buffer.from(header), data, ...(data.length % 2 ? [Buffer.from('\n')] : [])];
  })]);
}
function appFiles(machine: number, version = '0.10.0'): Record<string, Buffer> {
  return {
    'aks-desktop': elf(machine),
    'resources/headlamp-server': elf(machine),
    'resources/app-build-manifest.json': Buffer.from(JSON.stringify({ product: { name: 'aks-desktop', version } })),
    'resources/external-tools/az-cli/linux/bin/az': Buffer.from('#!/bin/sh\n'),
    'resources/external-tools/az-cli/linux/bin/az-wrapper': Buffer.from('#!/bin/sh\n'),
    'resources/external-tools/az-cli/linux/libexec/bin/az': Buffer.from('#!/bin/sh\n'),
    'resources/external-tools/az-cli/linux/python/bin/python3': elf(machine),
    'resources/external-tools/az-cli/linux/python/lib/libpython3.14.so.1.0': elf(machine),
    'resources/external-tools/az-cli/linux/cliextensions/deep/module.so': elf(machine),
  };
}
function packages(root: string, arch = 'arm64', controlVersion = '0.10.0', controlName = './control'): void {
  const machine = arch === 'arm64' ? 183 : 62;
  const debArch = arch === 'arm64' ? 'arm64' : 'amd64';
  const files = appFiles(machine);
  const data = tar(Object.fromEntries(Object.entries(files).map(([name, data]) => [`./opt/AKS-Desktop/${name}`, data])));
  put(root, `aks-desktop_0.10.0-1_${debArch}.deb`, ar({
    'debian-binary': Buffer.from('2.0\n'),
    'control.tar.gz': gzipSync(tar({ [controlName]: Buffer.from(`Package: aks-desktop\nVersion: ${controlVersion}\nArchitecture: ${debArch}\n`) })),
    'data.tar.gz': gzipSync(data),
  }));
  put(root, `aks-desktop-0.10.0-linux-${arch}.tar.gz`, gzipSync(tar(files)));
}
const extraction = process.platform === 'linux' && spawnSync('tar', ['--version']).status === 0;
const extractionOptions = { skip: extraction ? false : 'Production archive extraction requires Linux tar; core ELF/ar/control tests remain portable' };

test('Debian versions reproduce pinned CI priority and sanitation exactly', () => {
  assert.equal(expectedLinuxDebVersion('0.10.0', {}), '0.10.0');
  assert.equal(expectedLinuxDebVersion('0.11.0-rc-1', { BUILD_BUILDNUMBER: '20261106-2' }), '0.11.0~rc~1-20261106_2');
  assert.equal(expectedLinuxDebVersion('0.10.0', { BUILD_NUMBER: 'first', TRAVIS_BUILD_NUMBER: 'second', BUILD_BUILDNUMBER: 'third' }), '0.10.0-first');
  for (const name of ['TRAVIS_BUILD_NUMBER', 'APPVEYOR_BUILD_NUMBER', 'CIRCLE_BUILD_NUM', 'BUILD_BUILDNUMBER', 'CI_PIPELINE_IID']) {
    assert.equal(expectedLinuxDebVersion('0.10.0', { [name]: '20260924.2' }), '0.10.0-20260924.2');
  }
});
test('control fields are exact, not arbitrary CI-suffix or duplicate metadata', () => {
  assert.deepEqual(parseLinuxDebControl('Package: aks-desktop\nArchitecture: arm64\nVersion: 0.10.0-20260924.2\n Description continuation\n'), { architecture: 'arm64', version: '0.10.0-20260924.2' });
  assert.throws(() => parseLinuxDebControl('Architecture: arm64\n'), /Version/);
  assert.throws(() => parseLinuxDebControl('Architecture: arm64\nVersion: 1\nVersion: 2\n'), /duplicate/i);
});
test('portable ar reader respects odd-byte padding and rejects truncated/malformed members', () => {
  const root = temp();
  const file = put(root, 'package.deb', ar({ 'debian-binary': Buffer.from('2.0\n'), 'control.tar.gz': Buffer.from('odd') }));
  assert.deepEqual(readArMembers(file).map(member => [member.name, member.size]), [['debian-binary', 4], ['control.tar.gz', 3]]);
  fs.truncateSync(file, fs.statSync(file).size - 2);
  assert.throws(() => readArMembers(file), /truncated/i);
  put(root, 'package.deb', Buffer.from('not ar'));
  assert.throws(() => readArMembers(file), /ar/i);
});
test('all material ELF headers are scanned regardless of suffix; ordinary files are ignored', () => {
  const root = temp();
  put(root, 'nested/unknown', elf());
  put(root, 'script', '#!/bin/sh\n');
  assert.deepEqual(verifyLinuxElfTree(root, 'arm64').files, ['nested/unknown']);
  put(root, 'nested/deeper/module.so', elf(62));
  assert.throws(() => verifyLinuxElfTree(root, 'arm64'), /module.so.*62.*183/);
  assert.throws(() => verifyLinuxElfTree(temp(), 'arm64'), /no ELF/i);
});
test('wrong ELF class, byte order, version and truncation fail instead of being ignored', () => {
  for (const mutate of [(b: Buffer) => { b[4] = 1; }, (b: Buffer) => { b[5] = 2; }, (b: Buffer) => { b[6] = 0; }, (b: Buffer) => { b.writeUInt32LE(0, 20); }, (b: Buffer) => { b.writeUInt16LE(0, 16); }, (b: Buffer) => { b.writeUInt16LE(32, 52); }]) {
    const root = temp(); const data = elf(); mutate(data); put(root, 'bad', data);
    assert.throws(() => verifyLinuxElfTree(root, 'arm64'), /ELF.*bad|bad.*ELF/);
  }
  const root = temp(); put(root, 'short', elf().subarray(0, 22));
  assert.throws(() => verifyLinuxElfTree(root, 'arm64'), /ELF/);
});
test('required packaged app, backend, CLI and Python paths are independently mandatory', () => {
  for (const missing of ['aks-desktop', 'resources/headlamp-server', 'resources/external-tools/az-cli/linux/bin/az-wrapper', 'resources/external-tools/az-cli/linux/python/bin/python3', 'resources/external-tools/az-cli/linux/python/lib/libpython3.14.so.1.0']) {
    const root = temp(); Object.entries(appFiles(183)).forEach(([name, data]) => put(root, name, data));
    fs.unlinkSync(path.join(root, missing));
    assert.throws(() => verifyLinuxApp(root, 'arm64', '0.10.0'), /missing|required/i);
  }
});
test('package identity/version mismatches fail even when all binaries match', () => {
  const root = temp(); Object.entries(appFiles(183, '0.9.0')).forEach(([name, data]) => put(root, name, data));
  assert.throws(() => verifyLinuxApp(root, 'arm64', '0.10.0'), /version/i);
});
test('internal/absolute extraction-root file links work, required escaping links fail', { skip: process.platform === 'win32' ? 'Windows symlink creation requires privileges' : false }, () => {
  const root = temp(); Object.entries(appFiles(183)).forEach(([name, data]) => put(root, name, data));
  const python = path.join(root, 'resources/external-tools/az-cli/linux/python/bin/python3');
  fs.renameSync(python, python + '.14'); fs.symlinkSync('python3.14', python);
  fs.symlinkSync('/resources/external-tools/az-cli/linux/python/bin/python3.14', path.join(root, 'absolute-python'));
  fs.symlinkSync('does-not-exist', path.join(root, 'unneeded-link'));
  assert.ok(verifyLinuxApp(root, 'arm64', '0.10.0').files.length >= 5);
  fs.unlinkSync(python); fs.symlinkSync('../../../../../../../outside', python);
  assert.throws(() => verifyLinuxApp(root, 'arm64'), /escape|missing|required/);
});
test('valid DEB/tar payloads and both exact architectures pass in isolated staging', extractionOptions, () => {
  const root = temp(); packages(root); packages(root, 'x64', '0.10.0', 'control');
  verifyLinuxArtifacts(root, '0.10.0', ['x64', 'arm64']);
  const dist = temp(); packages(dist); put(dist, 'aks-desktop.AppImage', 'not published');
  const stage = temp(); stageLinuxArtifacts(dist, stage, '0.10.0', ['arm64']);
  assert.deepEqual(fs.readdirSync(stage).sort(), ['aks-desktop-0.10.0-linux-arm64.tar.gz', 'aks-desktop_0.10.0-1_arm64.deb']);
});
for (const format of ['DEB', 'tarball']) {
  test(`${format} payload rejects a missing Azure CLI entrypoint`, extractionOptions, () => {
    const root = temp(); packages(root);
    const files = appFiles(183);
    delete files['resources/external-tools/az-cli/linux/libexec/bin/az'];
    if (format === 'DEB') {
      put(root, 'aks-desktop_0.10.0-1_arm64.deb', ar({ 'debian-binary': Buffer.from('2.0\n'), 'control.tar.gz': gzipSync(tar({ control: Buffer.from('Version: 0.10.0\nArchitecture: arm64\n') })), 'data.tar.gz': gzipSync(tar(files)) }));
    } else put(root, 'aks-desktop-0.10.0-linux-arm64.tar.gz', gzipSync(tar(files)));
    assert.throws(() => verifyLinuxArtifacts(root, '0.10.0', ['arm64']), /required payload path.*libexec\/bin\/az/);
  });
}
test('strict staging rejects missing, empty, stale and extra artifacts', extractionOptions, () => {
  for (const alter of [(r: string) => fs.unlinkSync(path.join(r, 'aks-desktop_0.10.0-1_arm64.deb')), (r: string) => put(r, 'aks-desktop_0.10.0-1_arm64.deb', ''), (r: string) => put(r, 'aks-desktop.AppImage', 'extra'), (r: string) => put(r, 'aks-desktop-0.9.0-linux-armv7l.tar.gz', 'stale')]) {
    const root = temp(); packages(root); alter(root);
    assert.throws(() => verifyLinuxArtifacts(root, '0.10.0', ['arm64']), /missing|empty|unexpected/i);
  }
});
test('control Architecture and exact CI iteration cannot be faked by filenames', extractionOptions, () => {
  const root = temp(); packages(root, 'x64');
  fs.renameSync(path.join(root, 'aks-desktop_0.10.0-1_amd64.deb'), path.join(root, 'aks-desktop_0.10.0-1_arm64.deb'));
  fs.renameSync(path.join(root, 'aks-desktop-0.10.0-linux-x64.tar.gz'), path.join(root, 'aks-desktop-0.10.0-linux-arm64.tar.gz'));
  assert.throws(() => verifyLinuxArtifacts(root, '0.10.0', ['arm64']), /Architecture/);
  const stale = temp(); packages(stale, 'arm64', '0.10.0-20260924.2');
  assert.throws(() => verifyLinuxArtifacts(stale, '0.10.0', ['arm64'], { BUILD_BUILDNUMBER: '20261106.2' }), /Version.*20261106.2/);
});
test('nested wrong ELF fails independently in DEB and tarball payloads', extractionOptions, () => {
  for (const badDeb of [true, false]) {
    const root = temp(); packages(root);
    const files = appFiles(183); files['resources/deep/foreign'] = elf(62);
    if (badDeb) {
      put(root, 'aks-desktop_0.10.0-1_arm64.deb', ar({ 'debian-binary': Buffer.from('2.0\n'), 'control.tar.gz': gzipSync(tar({ control: Buffer.from('Version: 0.10.0\nArchitecture: arm64\n') })), 'data.tar.gz': gzipSync(tar(files)) }));
    } else put(root, 'aks-desktop-0.10.0-linux-arm64.tar.gz', gzipSync(tar(files)));
    assert.throws(() => verifyLinuxArtifacts(root, '0.10.0', ['arm64']), /foreign.*62.*183/);
  }
});
test('DEB absolute required links resolve inside the full payload root', extractionOptions, () => {
  const root = temp(); packages(root);
  const files: Record<string, Buffer | string> = Object.fromEntries(Object.entries(appFiles(183)).map(([name, data]) => [`opt/AKS-Desktop/${name}`, data]));
  const python = 'opt/AKS-Desktop/resources/external-tools/az-cli/linux/python/bin/python3';
  files[python + '.14'] = files[python]; files[python] = '/' + python + '.14';
  put(root, 'aks-desktop_0.10.0-1_arm64.deb', ar({ 'debian-binary': Buffer.from('2.0\n'), 'control.tar.gz': gzipSync(tar({ control: Buffer.from('Version: 0.10.0\nArchitecture: arm64\n') })), 'data.tar.gz': gzipSync(tar(files)) }));
  verifyLinuxArtifacts(root, '0.10.0', ['arm64']);
});
test('required app, backend, Python and libpython roles must be verified ELF, not scripts or PE', () => {
  for (const role of ['aks-desktop', 'resources/headlamp-server', 'resources/external-tools/az-cli/linux/python/bin/python3', 'resources/external-tools/az-cli/linux/python/lib/libpython3.14.so.1.0']) {
    for (const replacement of [Buffer.from('#!/bin/sh\n'), Buffer.from('MZ-not-a-Linux-binary')]) {
      const root = temp(); Object.entries(appFiles(183)).forEach(([name, data]) => put(root, name, data));
      put(root, role, replacement);
      assert.throws(() => verifyLinuxApp(root, 'arm64', '0.10.0'), /required.*ELF|ELF.*required/i);
    }
  }
});
test('DEB and tar main executable cannot be PE or malformed ELF while other ELF roles are valid', extractionOptions, () => {
  for (const badDeb of [true, false]) {
    for (const replacement of [Buffer.from('MZ-not-a-Linux-binary'), elf().subarray(0, 22)]) {
      const root = temp(); packages(root);
      const files = appFiles(183); files['aks-desktop'] = replacement;
      if (badDeb) put(root, 'aks-desktop_0.10.0-1_arm64.deb', ar({ 'debian-binary': Buffer.from('2.0\n'), 'control.tar.gz': gzipSync(tar({ control: Buffer.from('Version: 0.10.0\nArchitecture: arm64\n') })), 'data.tar.gz': gzipSync(tar(files)) }));
      else put(root, 'aks-desktop-0.10.0-linux-arm64.tar.gz', gzipSync(tar(files)));
      assert.throws(() => verifyLinuxArtifacts(root, '0.10.0', ['arm64']), /ELF.*aks-desktop|ELF: aks-desktop/);
    }
  }
});
test('missing or duplicate DEB members and failed tar leave no scratch directory', extractionOptions, () => {
  const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('verify-linux-artifacts-')).sort();
  const malformedMembers: Array<{ members: Record<string, Buffer>; error: RegExp }> = [
    { members: { 'debian-binary': Buffer.from('2.0\n') }, error: /Expected exactly one control/ },
    { members: { 'debian-binary': Buffer.from('2.0\n'), 'control.tar': tar({ control: Buffer.from('Version: 0.10.0\nArchitecture: arm64\n') }), 'control.tar.gz': gzipSync(tar({})) }, error: /Expected exactly one control/ },
    { members: { 'debian-binary': Buffer.from('2.0\n'), 'control.tar.gz': Buffer.from('broken') }, error: /tar -tf.*control\.tar\.gz/ },
  ];
  for (const { members, error } of malformedMembers) {
    const root = temp(); packages(root);
    put(root, 'aks-desktop_0.10.0-1_arm64.deb', ar(members));
    assert.throws(() => verifyLinuxArtifacts(root, '0.10.0', ['arm64']), error);
  }
  const root = temp(); packages(root);
  const oldPath = process.env.PATH; process.env.PATH = temp();
  try { assert.throws(() => verifyLinuxArtifacts(root, '0.10.0', ['arm64']), /tar.*ENOENT/); }
  finally { process.env.PATH = oldPath; }
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('verify-linux-artifacts-')).sort(), before);
});
const nativeOptions = { skip: process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) ? 'Native Linux invocation requires a Linux x64/arm64 host' : false };
test('offline proxy help uses the bundled wrapper and isolated extensions/config with a timeout', nativeOptions, () => {
  const root = temp();
  const az = put(root, 'bin/az-wrapper', '#!/bin/sh\n');
  fs.mkdirSync(path.join(root, 'cliextensions/connectedk8s'), { recursive: true });
  let config = '';
  const help = verifyLinuxProxyHelp(az, process.arch, (file, args, options) => {
    assert.equal(file, az); assert.deepEqual(args, ['connectedk8s', 'proxy', '--help']);
    assert.equal(options.timeout, 120000);
    assert.equal(options.env.AZURE_EXTENSION_DIR, path.join(root, 'cliextensions'));
    assert.equal(options.env.AZURE_EXTENSION_USE_DYNAMIC_INSTALL, 'no');
    assert.equal(options.env.AZURE_CORE_COLLECT_TELEMETRY, 'no');
    config = options.env.AZURE_CONFIG_DIR!;
    assert.ok(fs.existsSync(config));
    return 'Command\n    az connectedk8s proxy : Get access to a connected cluster.\n';
  });
  assert.match(help, /az connectedk8s proxy/); assert.ok(!fs.existsSync(config));
  for (const failure of [Object.assign(new Error('spawn ETIMEDOUT'), { code: 'ETIMEDOUT' }), new Error('exit 1')]) {
    assert.throws(() => verifyLinuxProxyHelp(az, process.arch, () => { throw failure; }), /ETIMEDOUT|exit 1/);
  }
  assert.throws(() => verifyLinuxProxyHelp(az, process.arch, () => ''), /help/i);
});
test('Linux proxy refuses host mismatch and absent bundled extensions', () => {
  const root = temp(); const az = put(root, 'bin/az-wrapper', '#!/bin/sh\n');
  assert.throws(() => verifyLinuxProxyHelp(az, process.arch === 'arm64' ? 'x64' : 'arm64', () => { assert.fail('must not invoke foreign binary'); }), /native|host/i);
  if (process.platform === 'linux') assert.throws(() => verifyLinuxProxyHelp(az, process.arch), /extension/i);
});
test('a DEB must contain exactly one valid Debian format marker', extractionOptions, () => {
  for (const marker of [undefined, Buffer.from('1.0\n')]) {
    const root = temp(); packages(root);
    const members: Record<string, Buffer> = { 'control.tar.gz': gzipSync(tar({ control: Buffer.from('Version: 0.10.0\nArchitecture: arm64\n') })), 'data.tar.gz': gzipSync(tar(appFiles(183))) };
    if (marker) members['debian-binary'] = marker;
    put(root, 'aks-desktop_0.10.0-1_arm64.deb', ar(members));
    assert.throws(() => verifyLinuxArtifacts(root, '0.10.0', ['arm64']), /debian-binary|Debian format/);
  }
});
test('DEB control links cannot borrow matching metadata from the build host', extractionOptions, () => {
  const root = temp(); packages(root);
  const hostControl = put(temp(), 'control', 'Version: 0.10.0\nArchitecture: arm64\n');
  put(root, 'aks-desktop_0.10.0-1_arm64.deb', ar({ 'debian-binary': Buffer.from('2.0\n'), 'control.tar.gz': gzipSync(tar({ control: hostControl })), 'data.tar.gz': gzipSync(tar(appFiles(183))) }));
  assert.throws(() => verifyLinuxArtifacts(root, '0.10.0', ['arm64']), /control/i);
});
test('whole payload tar listings over 1 MiB are supported without reading entire ELF files', extractionOptions, () => {
  const root = temp(); packages(root);
  const files = appFiles(183);
  for (let i = 0; i < 6000; i++) files[`resources/${'a'.repeat(110)}/${'b'.repeat(80)}-${i}`] = Buffer.from('data');
  assert.ok(Object.keys(files).join('\n').length > 1024 * 1024);
  put(root, 'aks-desktop-0.10.0-linux-arm64.tar.gz', gzipSync(tar(files)));
  verifyLinuxArtifacts(root, '0.10.0', ['arm64']);
});
test('real xz control/data extraction follows supported member names', { skip: !extraction || spawnSync('xz', ['--version']).status !== 0 ? 'Linux tar/xz unavailable; gzip extraction and core metadata remain covered' : false }, () => {
  const root = temp(); packages(root);
  const compress = (data: Buffer) => execFileSync('xz', ['-c'], { input: data });
  put(root, 'aks-desktop_0.10.0-1_arm64.deb', ar({ 'debian-binary': Buffer.from('2.0\n'), 'control.tar.xz': compress(tar({ './control': Buffer.from('Version: 0.10.0\nArchitecture: arm64\n') })), 'data.tar.xz': compress(tar(appFiles(183))) }));
  verifyLinuxArtifacts(root, '0.10.0', ['arm64']);
});
