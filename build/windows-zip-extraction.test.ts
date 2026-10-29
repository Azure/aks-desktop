// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  longPathsEnabledFromRegQuery,
  WINDOWS_MAX_PATH_LENGTH,
  windowsLongPathsQuery,
  windowsPathLimitMessage,
  windowsPathLimitViolations,
  windowsSystemToolPath,
  windowsZipExtraction,
  windowsZipListing,
} from './windows-zip-extraction';

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Writes an uncompressed ZIP whose entry names are used verbatim, including unsafe ones. */
function writeStoredZip(archivePath: string, entries: Record<string, string>): void {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(contents, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(archivePath, Buffer.concat([...locals, centralDirectory, end]));
}

function windowsTempRoot(t: TestContext, prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const isWindows = { skip: process.platform !== 'win32' };

test('resolves tar.exe from SystemRoot rather than PATH', () => {
  const env = { SystemRoot: 'D:\\Windows', PATH: 'C:\\Program Files\\Git\\usr\\bin' };
  assert.equal(windowsZipExtraction('a.zip', 'out', env).command, 'D:\\Windows\\System32\\tar.exe');
  assert.equal(windowsZipListing('a.zip', env).command, 'D:\\Windows\\System32\\tar.exe');
  assert.equal(windowsLongPathsQuery(env).command, 'D:\\Windows\\System32\\reg.exe');
  assert.equal(windowsSystemToolPath('tar.exe', { SYSTEMROOT: 'C:\\Windows' }), 'C:\\Windows\\System32\\tar.exe');
});

test('refuses to locate system tools without an absolute SystemRoot', () => {
  for (const env of [{}, { SystemRoot: '' }, { SystemRoot: 'Windows' }, { SystemRoot: '\\\\server\\share' }]) {
    assert.throws(() => windowsSystemToolPath('tar.exe', env), /SystemRoot must be an absolute drive path/);
  }
});

test('passes Windows ZIP paths as literal arguments', () => {
  const archive = "C:\\O'Brien [build] & tools\\input.zip";
  const destination = "C:\\O'Brien [build] & tools\\out";
  const env = { SystemRoot: 'C:\\Windows' };
  assert.deepEqual(windowsZipExtraction(archive, destination, env).args, ['-x', '-f', archive, '-C', destination]);
  assert.deepEqual(windowsZipListing(archive, env).args, ['-t', '-f', archive]);
});

test('reads LongPathsEnabled from reg query output', () => {
  const output = (value: string) =>
    `\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\FileSystem\r\n    LongPathsEnabled    REG_DWORD    ${value}\r\n`;
  assert.equal(longPathsEnabledFromRegQuery(output('0x1')), true);
  assert.equal(longPathsEnabledFromRegQuery(output('0x0')), false);
  assert.equal(longPathsEnabledFromRegQuery(''), false);
  assert.equal(longPathsEnabledFromRegQuery('LongPathsEnabled    REG_SZ    1'), false);
});

test('reports only extracted paths beyond the Windows path limit', () => {
  const outputDir = 'C:\\tools';
  const room = WINDOWS_MAX_PATH_LENGTH - outputDir.length - 1;
  const atLimit = `dir/${'a'.repeat(room - 4)}`;
  const overLimit = `dir/${'b'.repeat(room - 3)}`;
  const overLimitDirectory = `${'c'.repeat(room + 5)}/`;
  const violations = windowsPathLimitViolations(
    ['', '  ', atLimit, overLimit, `${overLimit}\r`, overLimitDirectory],
    outputDir
  );
  assert.deepEqual(violations.map(violation => violation.length), [
    WINDOWS_MAX_PATH_LENGTH + 5,
    WINDOWS_MAX_PATH_LENGTH + 1,
  ]);
  assert.equal(violations[1].fullPath, `${outputDir}\\dir\\${'b'.repeat(room - 3)}`);
});

test('explains how to resolve path limit violations', () => {
  const message = windowsPathLimitMessage(
    [{ fullPath: 'C:\\long\\path.pyc', length: 278 }, { fullPath: 'C:\\other.pyc', length: 262 }],
    'C:\\long',
    'Azure CLI 2.90.0'
  );
  assert.match(message, /^Azure CLI 2\.90\.0 cannot be installed at:\n  C:\\long\n/);
  assert.match(message, /2 extracted path\(s\) would exceed the Windows 260-character limit; the longest is 278/);
  assert.match(message, /Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' LongPathsEnabled 1/);
  assert.match(message, /at least 19 characters shorter/);
});

test('extracts Windows ZIPs under paths containing quotes and wildcards', isWindows, t => {
  const root = windowsTempRoot(t, "aks-O'Brien [build] & tools-");
  const archive = path.join(root, 'input.zip');
  writeStoredZip(archive, { 'bin/payload.txt': 'zip contents' });
  const outputDir = path.join(root, 'out');
  fs.mkdirSync(outputDir);
  const extraction = windowsZipExtraction(archive, outputDir);
  execFileSync(extraction.command, extraction.args, { stdio: 'pipe' });
  assert.equal(fs.readFileSync(path.join(outputDir, 'bin', 'payload.txt'), 'utf8'), 'zip contents');
  const listing = windowsZipListing(archive);
  assert.deepEqual(
    execFileSync(listing.command, listing.args, { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean),
    ['bin/payload.txt']
  );
});

test('extracts Windows ZIP entries beyond MAX_PATH', isWindows, t => {
  const root = windowsTempRoot(t, 'aks-long-path-');
  const archive = path.join(root, 'input.zip');
  const outputDir = path.join(root, 'out');
  const entry = `${'nested_directory_name/'.repeat(12)}payload.pyc`;
  assert.ok(path.join(outputDir, entry).length > WINDOWS_MAX_PATH_LENGTH);
  writeStoredZip(archive, { [entry]: 'deep contents' });
  fs.mkdirSync(outputDir);
  const extraction = windowsZipExtraction(archive, outputDir);
  execFileSync(extraction.command, extraction.args, { stdio: 'pipe' });
  assert.equal(fs.readFileSync(path.join(outputDir, entry), 'utf8'), 'deep contents');
});

test('keeps Windows ZIP entries inside the destination', isWindows, t => {
  const root = windowsTempRoot(t, 'aks-zip-slip-');
  const archive = path.join(root, 'input.zip');
  const outputDir = path.join(root, 'out');
  const absoluteTarget = path.join(root, 'absolute-escape.txt');
  writeStoredZip(archive, {
    '../dotdot-escape.txt': 'escaped',
    [absoluteTarget.replace(/\\/g, '/')]: 'escaped',
    'inside.txt': 'kept',
  });
  fs.mkdirSync(outputDir);
  const extraction = windowsZipExtraction(archive, outputDir);
  assert.throws(() => execFileSync(extraction.command, extraction.args, { stdio: 'pipe' }));
  assert.equal(fs.existsSync(path.join(root, 'dotdot-escape.txt')), false);
  assert.equal(fs.existsSync(absoluteTarget), false);
  assert.equal(fs.readFileSync(path.join(outputDir, 'inside.txt'), 'utf8'), 'kept');
});
