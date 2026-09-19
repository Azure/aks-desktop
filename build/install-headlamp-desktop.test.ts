// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';
import {
  HEADLAMP_DESKTOP_INSTALL_STEPS,
  installHeadlampDesktopDependencies,
} from './install-headlamp-desktop';

test('installs only the Headlamp dependencies required by desktop packaging', () => {
  const commands: string[] = [];
  installHeadlampDesktopDependencies('/workspace/headlamp', (args, cwd) => {
    commands.push(`${path.relative('/workspace/headlamp', cwd) || '.'}:${args.join(' ')}`);
  });

  assert.deepEqual(commands, [
    'frontend:ci --prefer-offline --no-audit --no-fund --omit=dev',
    '.:run backend:build',
    'app:ci --prefer-offline --no-audit --no-fund',
  ]);
  assert.equal(commands.length, HEADLAMP_DESKTOP_INSTALL_STEPS.length);
});

test('stops the Headlamp desktop install at the first failed step', t => {
  const commands: string[] = [];
  t.mock.method(console, 'log', () => undefined);
  assert.throws(
    () =>
      installHeadlampDesktopDependencies('/workspace/headlamp', (args, cwd) => {
        commands.push(`${path.basename(cwd)}:${args.join(' ')}`);
        if (cwd.endsWith('frontend')) {
          throw new Error('clean install failed');
        }
      }),
    /clean install failed/
  );
  assert.deepEqual(commands, ['frontend:ci --prefer-offline --no-audit --no-fund --omit=dev']);
});