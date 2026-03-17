#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Cross-platform Node.js replacement for headlamp-submodule.sh --reset
 * Resets the headlamp submodule to the commit recorded in the superproject.
 *
 * Usage:
 *   node scripts/setup-submodule.mjs          # reset submodule (default)
 *   node scripts/setup-submodule.mjs --reset   # same as above
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = dirname(dirname(__filename));
const HEADLAMP_DIR = join(ROOT_DIR, 'headlamp');

// Check for dirty submodule
if (existsSync(HEADLAMP_DIR)) {
  try {
    const status = execSync('git status --porcelain', {
      cwd: HEADLAMP_DIR,
      encoding: 'utf-8',
    }).trim();
    if (status) {
      console.warn(
        '[warn] You have local changes inside the headlamp submodule that will be overwritten by reset.'
      );
    }
  } catch {
    // Not initialized yet — that's fine
  }
}

console.log('[info] Resetting headlamp submodule to superproject recorded commit');

execSync('git submodule update --init --checkout headlamp', {
  cwd: ROOT_DIR,
  stdio: 'inherit',
});

// Show current commit
const desc = execSync('git log --oneline -1', {
  cwd: HEADLAMP_DIR,
  encoding: 'utf-8',
}).trim();

console.log(`[info] Headlamp now at: ${desc}`);
console.log('[done] Submodule reset to recorded commit.');
