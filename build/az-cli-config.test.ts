// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  azCliBinaryPath,
  azCliTargetDir,
  azCliTargetDirHasContent,
  expectedAzCliExtensions,
  generateWindowsAzWrapperScript,
  isAzCliStagedForTarget,
  readAzureCliConfig,
  readStagedAzCli,
  resolveAzCliVersion,
  sameExtensionSet,
  WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME,
  WINDOWS_AZ_CLI_ORIGINAL_FILENAME,
  writeStagedAzCli,
} from './az-cli-config';

const tempDirs: string[] = [];

afterEach(() => {
  tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

const AZURE_CLI_CONFIG = {
  version: '2.78.0',
  extensions: ['resource-graph', 'alertsmanagement'],
  win32: { version: '2.77.0' },
};

function createRoot(azureCli: unknown = AZURE_CLI_CONFIG): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'az-cli-config-'));
  tempDirs.push(rootDir);
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ config: { externalTools: { azureCli } } })
  );
  return rootDir;
}

/** Creates a fake staged az-cli install: the wrapper binary plus a marker. */
function stageAzCli(rootDir: string, platform: string, staged: { version?: string; extensions?: string[] }): void {
  const binaryPath = azCliBinaryPath(rootDir, platform);
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, '#!/bin/sh\n');
  writeStagedAzCli(rootDir, platform, staged);
}

test('reads the azureCli config block from package.json', () => {
  const rootDir = createRoot();
  assert.deepEqual(readAzureCliConfig(rootDir), AZURE_CLI_CONFIG);
});

test('a platform override takes precedence over the top-level version pin', () => {
  assert.equal(resolveAzCliVersion(AZURE_CLI_CONFIG, 'win32'), '2.77.0');
  assert.equal(resolveAzCliVersion(AZURE_CLI_CONFIG, 'linux'), '2.78.0');
  assert.equal(resolveAzCliVersion(undefined, 'linux'), undefined);
});

test('treats extension sets as equal regardless of order', () => {
  assert.equal(sameExtensionSet(['a', 'b'], ['b', 'a']), true);
  assert.equal(sameExtensionSet(['a'], ['a', 'b']), false);
  assert.equal(sameExtensionSet([], []), true);
});

test('round-trips the staged marker and tolerates a missing or corrupt one', () => {
  const rootDir = createRoot();

  assert.equal(readStagedAzCli(rootDir, 'linux'), undefined);

  writeStagedAzCli(rootDir, 'linux', { version: '2.78.0', extensions: ['resource-graph', 'alertsmanagement'] });
  assert.deepEqual(readStagedAzCli(rootDir, 'linux'), {
    version: '2.78.0',
    extensions: ['resource-graph', 'alertsmanagement'],
  });

  fs.writeFileSync(path.join(azCliTargetDir(rootDir, 'linux'), '.az-cli-staged.json'), 'not json');
  assert.equal(readStagedAzCli(rootDir, 'linux'), undefined);
});

test('a current marker matching the pinned version and extensions is staged', () => {
  const rootDir = createRoot();
  stageAzCli(rootDir, 'linux', { version: '2.78.0', extensions: ['resource-graph', 'alertsmanagement'] });

  assert.equal(
    isAzCliStagedForTarget(rootDir, 'linux', resolveAzCliVersion(AZURE_CLI_CONFIG, 'linux'), ['resource-graph', 'alertsmanagement']),
    true
  );
});

test('a marker with an older version is not staged', () => {
  const rootDir = createRoot();
  stageAzCli(rootDir, 'linux', { version: '2.60.0', extensions: ['resource-graph', 'alertsmanagement'] });

  assert.equal(
    isAzCliStagedForTarget(rootDir, 'linux', resolveAzCliVersion(AZURE_CLI_CONFIG, 'linux'), ['resource-graph', 'alertsmanagement']),
    false
  );
});

test('a marker with a mismatched extension set is not staged, independent of order', () => {
  const rootDir = createRoot();
  stageAzCli(rootDir, 'linux', { version: '2.78.0', extensions: [] });

  assert.equal(
    isAzCliStagedForTarget(rootDir, 'linux', resolveAzCliVersion(AZURE_CLI_CONFIG, 'linux'), ['resource-graph', 'alertsmanagement']),
    false
  );

  // Order-independence: matching extensions listed in a different order are still current.
  const rootDir2 = createRoot();
  stageAzCli(rootDir2, 'linux', { version: '2.78.0', extensions: ['b', 'a'] });
  assert.equal(isAzCliStagedForTarget(rootDir2, 'linux', '2.78.0', ['a', 'b']), true);
});

test('a missing marker is not staged even if the wrapper binary exists', () => {
  const rootDir = createRoot();
  const binaryPath = azCliBinaryPath(rootDir, 'linux');
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, '#!/bin/sh\n');

  assert.equal(
    isAzCliStagedForTarget(rootDir, 'linux', resolveAzCliVersion(AZURE_CLI_CONFIG, 'linux'), ['resource-graph', 'alertsmanagement']),
    false
  );
});

test('a corrupt marker is not staged', () => {
  const rootDir = createRoot();
  const binaryPath = azCliBinaryPath(rootDir, 'linux');
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, '#!/bin/sh\n');
  fs.writeFileSync(path.join(azCliTargetDir(rootDir, 'linux'), '.az-cli-staged.json'), 'not json');

  assert.equal(
    isAzCliStagedForTarget(rootDir, 'linux', resolveAzCliVersion(AZURE_CLI_CONFIG, 'linux'), ['resource-graph', 'alertsmanagement']),
    false
  );
});

test('a missing wrapper binary is not staged even with a valid marker', () => {
  const rootDir = createRoot();
  writeStagedAzCli(rootDir, 'linux', { version: '2.78.0', extensions: ['resource-graph', 'alertsmanagement'] });

  assert.equal(
    isAzCliStagedForTarget(rootDir, 'linux', resolveAzCliVersion(AZURE_CLI_CONFIG, 'linux'), ['resource-graph', 'alertsmanagement']),
    false
  );
});

test('an undefined expected version is never staged', () => {
  const rootDir = createRoot();
  stageAzCli(rootDir, 'linux', { version: '2.78.0', extensions: ['resource-graph', 'alertsmanagement'] });

  assert.equal(isAzCliStagedForTarget(rootDir, 'linux', undefined, ['resource-graph', 'alertsmanagement']), false);
});

test('a missing target directory has no content', () => {
  const rootDir = createRoot();
  assert.equal(azCliTargetDirHasContent(rootDir, 'linux'), false);
});

test('an empty target directory has no content', () => {
  const rootDir = createRoot();
  fs.mkdirSync(azCliTargetDir(rootDir, 'linux'), { recursive: true });
  assert.equal(azCliTargetDirHasContent(rootDir, 'linux'), false);
});

test('a target directory with only a leftover extension and no wrapper has content', () => {
  const rootDir = createRoot();
  const targetDir = azCliTargetDir(rootDir, 'linux');
  // Simulates an install interrupted before the wrapper-script step: the
  // extension directory was copied over, but bin/az-wrapper never got
  // written. This must still count as an existing install so download-az-cli
  // wipes it rather than overlaying a fresh install on top of the stale
  // extension.
  fs.mkdirSync(path.join(targetDir, 'cliextensions', 'aks-preview'), { recursive: true });
  assert.equal(fs.existsSync(azCliBinaryPath(rootDir, 'linux')), false);
  assert.equal(azCliTargetDirHasContent(rootDir, 'linux'), true);
});

test('a fully staged target directory has content', () => {
  const rootDir = createRoot();
  stageAzCli(rootDir, 'linux', { version: '2.78.0', extensions: ['resource-graph', 'alertsmanagement'] });
  assert.equal(azCliTargetDirHasContent(rootDir, 'linux'), true);
});

test('resolves a Windows wrapper path using az.cmd', () => {
  assert.match(azCliBinaryPath('/repo', 'win32'), /az\.cmd$/);
  assert.match(azCliBinaryPath('/repo', 'linux'), /az-wrapper$/);
});

test('expectedAzCliExtensions returns the configured list on every platform, including win32', () => {
  assert.deepEqual(expectedAzCliExtensions(AZURE_CLI_CONFIG, 'linux'), ['resource-graph', 'alertsmanagement']);
  assert.deepEqual(expectedAzCliExtensions(AZURE_CLI_CONFIG, 'darwin'), ['resource-graph', 'alertsmanagement']);
  // installAzCliWindows() installs the same configured extensions into an
  // app-owned cliextensions directory, so win32 is expected to carry them too.
  assert.deepEqual(expectedAzCliExtensions(AZURE_CLI_CONFIG, 'win32'), ['resource-graph', 'alertsmanagement']);
  assert.deepEqual(expectedAzCliExtensions(undefined, 'linux'), []);
});

test('a win32 marker recording the configured extensions is staged', () => {
  const rootDir = createRoot();
  stageAzCli(rootDir, 'win32', { version: '2.77.0', extensions: ['resource-graph', 'alertsmanagement'] });

  assert.equal(
    isAzCliStagedForTarget(
      rootDir,
      'win32',
      resolveAzCliVersion(AZURE_CLI_CONFIG, 'win32'),
      expectedAzCliExtensions(AZURE_CLI_CONFIG, 'win32')
    ),
    true
  );
});

test('a win32 marker recording no extensions is no longer staged, now that win32 installs the configured set', () => {
  const rootDir = createRoot();
  stageAzCli(rootDir, 'win32', { version: '2.77.0', extensions: [] });

  assert.equal(
    isAzCliStagedForTarget(
      rootDir,
      'win32',
      resolveAzCliVersion(AZURE_CLI_CONFIG, 'win32'),
      expectedAzCliExtensions(AZURE_CLI_CONFIG, 'win32')
    ),
    false
  );
});

test('a marker recording only one of two configured extensions is not staged', () => {
  const rootDir = createRoot({ version: '2.78.0', extensions: ['resource-graph', 'alertsmanagement'] });
  // Simulates a marker written after a partial install (e.g. before the fix,
  // when a failed extension install was swallowed and the marker still
  // claimed the full requested set was staged, or here a marker honestly
  // recording that only one extension made it in).
  stageAzCli(rootDir, 'linux', { version: '2.78.0', extensions: ['resource-graph'] });

  assert.equal(
    isAzCliStagedForTarget(rootDir, 'linux', '2.78.0', ['resource-graph', 'alertsmanagement']),
    false
  );
});

test('the generated Windows wrapper isolates AZURE_EXTENSION_DIR under the CLI directory via %~dp0', () => {
  const script = generateWindowsAzWrapperScript();

  // Derived from the wrapper's own location (bin\..\cliextensions), not a
  // hardcoded build-machine absolute path - the bundle is relocatable.
  assert.match(script, new RegExp(`set "AZURE_EXTENSION_DIR=%~dp0\\.\\.\\\\${WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME}"`));
  assert.doesNotMatch(script, /[A-Za-z]:\\/); // no absolute Windows path baked in
});

test('the generated Windows wrapper delegates to the renamed original and forwards all arguments', () => {
  const script = generateWindowsAzWrapperScript();

  assert.match(script, new RegExp(`call "%~dp0${WINDOWS_AZ_CLI_ORIGINAL_FILENAME}" %\\*`));
});

test('the generated Windows wrapper propagates the delegated exit code', () => {
  const script = generateWindowsAzWrapperScript();

  assert.match(script, /exit \/b %ERRORLEVEL%/);
});
