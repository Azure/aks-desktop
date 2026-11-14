// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { writeDependencyTarget } from '../dependency-target';
import { packageTarget } from '../package-target';

for (const mode of [
  'normal',
  'prepared',
  'override',
  'unpacked',
  'prepare-error',
  'package-error',
  'invalid',
  'missing',
  'stale',
  'unsafe-temp',
] as const) {
  for (const arch of ['x64', 'arm64']) {
    test(`Windows ${arch} NSIS packaging: ${mode}`, (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nsis-package-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const source = path.join(
        root,
        'node_modules/@headlamp-k8s/headlamp-source/source'
      );
      const app = path.join(source, 'app');
      const dist = path.join(app, 'dist');
      fs.mkdirSync(path.join(source, 'backend'), { recursive: true });
      fs.mkdirSync(dist, { recursive: true });
      fs.writeFileSync(path.join(source, 'backend/headlamp-server'), 'backend');
      fs.writeFileSync(path.join(root, 'package.json'), '{"version":"9.8.7"}');
      writeDependencyTarget(root, { platform: 'win32', arch });
      const override = path.join(root, 'caller-owned');
      const previous = process.env.ELECTRON_BUILDER_NSIS_DIR;
      delete process.env.ELECTRON_BUILDER_NSIS_DIR;
      if (mode === 'override') {
        fs.mkdirSync(override);
        process.env.ELECTRON_BUILDER_NSIS_DIR = override;
      }
      t.after(() => {
        if (previous === undefined)
          delete process.env.ELECTRON_BUILDER_NSIS_DIR;
        else process.env.ELECTRON_BUILDER_NSIS_DIR = previous;
      });
      if (mode === 'normal' || mode === 'unsafe-temp') {
        const temp = path.join(
          root,
          mode === 'normal' ? 'safe temp space' : "build's temp"
        );
        fs.mkdirSync(temp);
        t.mock.method(require('node:os'), 'tmpdir', () => temp);
      }
      let owned: string | undefined;
      let packaged = false;
      const run = (args: string[], cwd: string, env?: NodeJS.ProcessEnv) => {
        assert.notEqual(
          mode,
          'unsafe-temp',
          'reject TEMP/TMP before any build step'
        );
        if (args[1] === 'nsis:toolset') {
          owned = args.find((arg) => arg.startsWith('--output='))!.slice(9);
          assert.ok(path.isAbsolute(owned));
          assert.deepEqual(fs.readdirSync(owned), []);
          assert.equal(cwd, root);
          if (mode === 'prepare-error') throw new Error('prepare failed');
        } else if (['package', 'package:prepared', 'build'].includes(args[1])) {
          assert.equal(cwd, app);
          assert.equal(
            args[1],
            mode === 'unpacked'
              ? 'build'
              : mode === 'prepared'
              ? 'package:prepared'
              : 'package'
          );
          assert.equal(
            env?.ELECTRON_BUILDER_NSIS_DIR,
            mode === 'override'
              ? override
              : mode === 'unpacked'
              ? undefined
              : owned
          );
          if (mode !== 'unpacked')
            assert.ok(fs.existsSync(env!.ELECTRON_BUILDER_NSIS_DIR!));
          if (mode === 'normal') {
            // Exercise the produced override against the installed consumer's Windows check.
            const consumer = path.join(
              __dirname,
              '../../node_modules/@headlamp-k8s/headlamp-source/source/app/node_modules/builder-util/out/envUtil.js'
            );
            const result = spawnSync(
              process.execPath,
              [
                '--eval',
                `
              Object.defineProperty(process, 'platform', { value: 'win32' });
              require(process.argv[1]).resolveEnvToolsetPath('ELECTRON_BUILDER_NSIS_DIR', 'directory')
                .then(value => require('node:assert/strict').equal(value, process.env.ELECTRON_BUILDER_NSIS_DIR))
                .catch(error => { console.error(error); process.exitCode = 1; });
            `,
                consumer,
              ],
              { env, encoding: 'utf8' }
            );
            assert.equal(result.status, 0, result.stderr);
          }
          if (mode === 'package-error') throw new Error('package failed');
          if (mode !== 'missing' && mode !== 'unpacked') {
            const filename = `aks-desktop-${
              mode === 'stale' ? '0.1.0' : '9.8.7'
            }-win-${arch}.exe`;
            const bytes = fs.readFileSync(
              path.join(__dirname, 'stubs/zlib-x86-unicode')
            );
            if (mode === 'invalid') bytes.writeUInt16LE(0, 0);
            fs.writeFileSync(path.join(dist, filename), bytes);
          }
          // Wrong-arch and stale files cannot satisfy the current installer gate.
          fs.writeFileSync(
            path.join(
              dist,
              `aks-desktop-9.8.7-win-${arch === 'x64' ? 'arm64' : 'x64'}.exe`
            ),
            'wrong arch'
          );
          packaged = true;
        } else if (mode !== 'override')
          assert.equal(env?.ELECTRON_BUILDER_NSIS_DIR, undefined);
      };
      t.mock.method(console, 'log', (message: string) => {
        if (message.startsWith('\nBuild complete')) assert.ok(packaged);
      });
      const execute = () =>
        packageTarget(
          { platform: 'win32', arch },
          root,
          run,
          {
            unpacked: mode === 'unpacked',
            reusePreparedAssets: mode === 'prepared',
          },
          { validateHost: () => undefined }
        );
      if (
        [
          'prepare-error',
          'package-error',
          'invalid',
          'missing',
          'stale',
          'unsafe-temp',
        ].includes(mode)
      ) {
        assert.throws(
          execute,
          mode === 'unsafe-temp'
            ? /TEMP\/TMP.*shell-unsafe.*Set TEMP and TMP.*restart/i
            : mode === 'prepare-error'
            ? /prepare failed/
            : mode === 'package-error'
            ? /package failed/
            : mode === 'invalid'
            ? /DOS signature/
            : /current installer/
        );
        assert.equal(
          fs.existsSync(path.join(dist, '.package-target.json')),
          false
        );
      } else {
        execute();
        assert.deepEqual(
          JSON.parse(
            fs.readFileSync(path.join(dist, '.package-target.json'), 'utf8')
          ),
          { platform: 'win32', arch }
        );
      }
      if (mode === 'override' || mode === 'unpacked' || mode === 'unsafe-temp')
        assert.equal(owned, undefined);
      else {
        assert.ok(owned, 'toolset preparation must run');
        assert.equal(
          fs.existsSync(owned),
          false,
          'parent must clean up through every failure path'
        );
      }
      if (mode === 'override') assert.equal(fs.existsSync(override), true);
    });
  }
}
